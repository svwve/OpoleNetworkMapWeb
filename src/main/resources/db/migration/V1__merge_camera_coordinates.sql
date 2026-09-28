DO $$
DECLARE
    has_lat BOOLEAN;
    has_lng BOOLEAN;
    has_latitude BOOLEAN;
    has_longitude BOOLEAN;
    has_conflicts BOOLEAN;
    lat_expression TEXT;
    lng_expression TEXT;
BEGIN
    IF to_regclass('cameras') IS NULL THEN
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'cameras' AND column_name = 'lat'
    ), EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'cameras' AND column_name = 'lng'
    ), EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'cameras' AND column_name = 'latitude'
    ), EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'cameras' AND column_name = 'longitude'
    )
    INTO has_lat, has_lng, has_latitude, has_longitude;

    IF NOT has_lat THEN
        ALTER TABLE cameras ADD COLUMN lat DOUBLE PRECISION;
    END IF;
    IF NOT has_lng THEN
        ALTER TABLE cameras ADD COLUMN lng DOUBLE PRECISION;
    END IF;

    IF has_latitude AND has_lat THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM cameras
                 WHERE lat IS NOT NULL AND latitude IS NOT NULL AND lat IS DISTINCT FROM latitude)'
            INTO has_conflicts;
        IF has_conflicts THEN
            RAISE EXCEPTION 'Camera latitude columns contain conflicting values; reconcile them before migration';
        END IF;
    END IF;
    IF has_longitude AND has_lng THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM cameras
                 WHERE lng IS NOT NULL AND longitude IS NOT NULL AND lng IS DISTINCT FROM longitude)'
            INTO has_conflicts;
        IF has_conflicts THEN
            RAISE EXCEPTION 'Camera longitude columns contain conflicting values; reconcile them before migration';
        END IF;
    END IF;

    lat_expression := CASE WHEN has_latitude THEN 'COALESCE(lat, latitude)' ELSE 'lat' END;
    lng_expression := CASE WHEN has_longitude THEN 'COALESCE(lng, longitude)' ELSE 'lng' END;
    EXECUTE format('UPDATE cameras SET lat = %s, lng = %s', lat_expression, lng_expression);

    ALTER TABLE cameras
        DROP COLUMN IF EXISTS latitude,
        DROP COLUMN IF EXISTS longitude;
END $$;
