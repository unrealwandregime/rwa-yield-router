CREATE OR REPLACE FUNCTION prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'source_observations',
    'yield_snapshots',
    'apy_components',
    'price_snapshots',
    'nav_snapshots',
    'tvl_aum_snapshots',
    'liquidity_snapshots',
    'utilization_snapshots',
    'risk_factor_snapshots',
    'risk_factor_evidence',
    'composite_risk_snapshots',
    'adapter_health',
    'alert_events',
    'admin_audit_logs',
    'security_audit_events',
    'data_deletion_receipts'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation()',
      'prevent_' || table_name || '_mutation',
      table_name
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_published_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_content jsonb;
  new_content jsonb;
BEGIN
  IF OLD.publication_status <> 'PUBLISHED' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'published % records cannot be deleted', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  IF NEW.publication_status NOT IN ('PUBLISHED', 'SUPERSEDED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'published % records may only remain published, be superseded, or be archived', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  old_content := to_jsonb(OLD) - ARRAY[
    'publication_status',
    'lifecycle_status',
    'status',
    'effective_to',
    'updated_at',
    'archived_at'
  ];
  new_content := to_jsonb(NEW) - ARRAY[
    'publication_status',
    'lifecycle_status',
    'status',
    'effective_to',
    'updated_at',
    'archived_at'
  ];

  IF old_content IS DISTINCT FROM new_content THEN
    RAISE EXCEPTION 'published % content is immutable; create a new version', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'products',
    'product_routes',
    'source_registry',
    'eligibility_rules',
    'redemption_terms',
    'transfer_restrictions',
    'custody_records',
    'audit_records',
    'proof_of_reserve_records',
    'risk_methodology_versions'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_published_record()',
      'protect_published_' || table_name,
      table_name
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_published_methodology_weight()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  methodology_id uuid;
  published boolean;
BEGIN
  methodology_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.methodology_version_id ELSE NEW.methodology_version_id END;

  SELECT publication_status = 'PUBLISHED'
  INTO published
  FROM risk_methodology_versions
  WHERE id = methodology_id;

  IF coalesce(published, false) THEN
    RAISE EXCEPTION 'weights for a published methodology are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_published_methodology_weights
BEFORE INSERT OR UPDATE OR DELETE ON risk_methodology_category_weights
FOR EACH ROW EXECUTE FUNCTION protect_published_methodology_weight();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_methodology_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  configured_category_count integer;
  invalid_category_count integer;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.publication_status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'methodology must be created as draft and published only after weights and review are recorded'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.publication_status = 'PUBLISHED' AND OLD.publication_status <> 'PUBLISHED' THEN
    SELECT count(DISTINCT category_id)
    INTO configured_category_count
    FROM risk_methodology_category_weights
    WHERE methodology_version_id = NEW.id;

    IF configured_category_count <> 6 THEN
      RAISE EXCEPTION 'published methodology must configure all six product categories'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
    INTO invalid_category_count
    FROM (
      SELECT category_id
      FROM risk_methodology_category_weights
      WHERE methodology_version_id = NEW.id
      GROUP BY category_id
      HAVING abs(sum(weight) - 1.0000000000) > 0.0000000001
    ) invalid;

    IF invalid_category_count <> 0 THEN
      RAISE EXCEPTION 'published methodology category weights must sum to 1'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER validate_methodology_before_publication
BEFORE INSERT OR UPDATE ON risk_methodology_versions
FOR EACH ROW EXECUTE FUNCTION validate_methodology_publication();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_simulation_finalization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_sum numeric;
  amount_sum numeric;
BEGIN
  IF NEW.status = 'FEASIBLE' AND OLD.status <> 'FEASIBLE' THEN
    SELECT coalesce(sum(allocation_ratio), 0), coalesce(sum(allocated_amount), 0)
    INTO allocation_sum, amount_sum
    FROM route_simulation_allocations
    WHERE simulation_id = NEW.id;

    IF allocation_sum <> 1.000000000000000000 THEN
      RAISE EXCEPTION 'feasible simulation allocations must sum exactly to 1'
        USING ERRCODE = '23514';
    END IF;

    IF amount_sum <> NEW.capital_amount THEN
      RAISE EXCEPTION 'feasible simulation allocated amounts must equal capital amount'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.status <> 'PENDING' THEN
    IF (to_jsonb(OLD) - ARRAY['name', 'is_saved', 'archived_at'])
       IS DISTINCT FROM
       (to_jsonb(NEW) - ARRAY['name', 'is_saved', 'archived_at']) THEN
      RAISE EXCEPTION 'finalized simulation inputs and results are immutable'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    IF (to_jsonb(OLD) - ARRAY[
          'status', 'allocation_total', 'gross_blended_apy', 'net_blended_apy',
          'comparative_risk_adjusted_apy', 'weighted_risk_score', 'data_confidence_score',
          'result_summary', 'infeasibility_diagnostics', 'completed_at', 'name', 'is_saved',
          'archived_at'
        ])
       IS DISTINCT FROM
       (to_jsonb(NEW) - ARRAY[
          'status', 'allocation_total', 'gross_blended_apy', 'net_blended_apy',
          'comparative_risk_adjusted_apy', 'weighted_risk_score', 'data_confidence_score',
          'result_summary', 'infeasibility_diagnostics', 'completed_at', 'name', 'is_saved',
          'archived_at'
        ]) THEN
      RAISE EXCEPTION 'simulation canonical inputs are immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER validate_route_simulation_update
BEFORE UPDATE ON route_simulations
FOR EACH ROW EXECUTE FUNCTION validate_simulation_finalization();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_job_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('RUNNING', 'CANCELLED'))
    OR (OLD.status = 'RUNNING' AND NEW.status IN ('SUCCEEDED', 'FAILED', 'DEAD_LETTERED', 'CANCELLED'))
    OR (OLD.status = 'FAILED' AND NEW.status = 'QUEUED')
  ) THEN
    RAISE EXCEPTION 'invalid job status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER enforce_job_run_status_transition
BEFORE UPDATE OF status ON job_runs
FOR EACH ROW EXECUTE FUNCTION enforce_job_status_transition();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_alert_destination_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rule_owner uuid;
  destination_owner uuid;
BEGIN
  SELECT user_id INTO rule_owner
  FROM alert_rules
  WHERE id = NEW.alert_rule_id;

  SELECT user_id INTO destination_owner
  FROM notification_destinations
  WHERE id = NEW.destination_id;

  IF rule_owner IS NULL OR destination_owner IS NULL OR rule_owner <> destination_owner THEN
    RAISE EXCEPTION 'alert rule and notification destination must have the same owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER enforce_alert_rule_destination_owner
BEFORE INSERT OR UPDATE ON alert_rule_destinations
FOR EACH ROW EXECUTE FUNCTION enforce_alert_destination_owner();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_delivery_destination_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_owner uuid;
  destination_owner uuid;
BEGIN
  SELECT rules.user_id INTO event_owner
  FROM alert_events events
  JOIN alert_rules rules ON rules.id = events.alert_rule_id
  WHERE events.id = NEW.alert_event_id;

  SELECT user_id INTO destination_owner
  FROM notification_destinations
  WHERE id = NEW.destination_id;

  IF event_owner IS NULL OR destination_owner IS NULL OR event_owner <> destination_owner THEN
    RAISE EXCEPTION 'alert event and notification destination must have the same owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER enforce_notification_delivery_owner
BEFORE INSERT OR UPDATE ON notification_deliveries
FOR EACH ROW EXECUTE FUNCTION enforce_delivery_destination_owner();
