-- Helper to count public nodes in a path (excluding the node itself)
CREATE OR REPLACE FUNCTION get_public_ancestor_count(node_path ltree) RETURNS INT AS $$
    SELECT count(*)::int
    FROM nodes
    WHERE node_path <@ path AND path != node_path AND visibility = 'PUBLIC';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION maintain_asset_refs() RETURNS TRIGGER AS $$
DECLARE
    delta_ref INT := 0;
    delta_public INT := 0;
    old_score INT := 0;
    new_score INT := 0;
BEGIN
    -- 1. Handle File-level Changes (Ref Count & Public Ref Count)
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.asset_id IS NOT NULL THEN
        delta_ref := delta_ref - 1;
        -- Calculate Old Score (Self + Ancestors)
        IF TG_OP = 'DELETE' OR OLD.asset_id IS DISTINCT FROM NEW.asset_id OR
           OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.path IS DISTINCT FROM NEW.path THEN
            old_score := (CASE WHEN OLD.visibility = 'PUBLIC' THEN 1 ELSE 0 END) + get_public_ancestor_count(OLD.path);
            delta_public := delta_public - old_score;
        END IF;

        -- Apply to Old Asset if AssetID changed
        IF TG_OP = 'UPDATE' AND OLD.asset_id IS DISTINCT FROM NEW.asset_id THEN
             UPDATE assets SET ref_count = ref_count - 1, public_ref_count = public_ref_count - old_score WHERE id = OLD.asset_id;
             delta_ref := 0; delta_public := 0; -- Reset for New Asset
        END IF;
    END IF;

    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.asset_id IS NOT NULL THEN
        delta_ref := delta_ref + 1;
        -- Calculate New Score
        IF TG_OP = 'INSERT' OR OLD.asset_id IS DISTINCT FROM NEW.asset_id OR
           OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.path IS DISTINCT FROM NEW.path THEN
            new_score := (CASE WHEN NEW.visibility = 'PUBLIC' THEN 1 ELSE 0 END) + get_public_ancestor_count(NEW.path);
            delta_public := delta_public + new_score;
        END IF;
    END IF;

    -- Apply remaining deltas
    IF delta_ref != 0 OR delta_public != 0 THEN
        UPDATE assets SET ref_count = ref_count + delta_ref, public_ref_count = public_ref_count + delta_public
        WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.asset_id ELSE NEW.asset_id END);
    END IF;

    -- 2. Handle Folder Visibility Propagation
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.type = 'FOLDER' AND OLD.visibility = 'PUBLIC' THEN
        IF TG_OP = 'DELETE' OR NEW.visibility != 'PUBLIC' THEN
            UPDATE assets a SET public_ref_count = public_ref_count - sub.count
            FROM (SELECT asset_id, count(*) as count FROM nodes WHERE path <@ OLD.path AND id != OLD.id AND type = 'FILE' AND asset_id IS NOT NULL GROUP BY asset_id) sub
            WHERE a.id = sub.asset_id;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.type = 'FOLDER' AND NEW.visibility = 'PUBLIC' AND OLD.visibility != 'PUBLIC' THEN
        UPDATE assets a SET public_ref_count = public_ref_count + sub.count
        FROM (SELECT asset_id, count(*) as count FROM nodes WHERE path <@ NEW.path AND id != NEW.id AND type = 'FILE' AND asset_id IS NOT NULL GROUP BY asset_id) sub
        WHERE a.id = sub.asset_id;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_maintain_refs
BEFORE INSERT OR UPDATE OR DELETE ON nodes
FOR EACH ROW EXECUTE FUNCTION maintain_asset_refs();