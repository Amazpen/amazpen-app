-- Make supplier_documents RLS admin-aware.
-- Previously the policies only allowed business_members, so an admin viewing a
-- business they are not a member of got a 403 on both reading and uploading
-- supplier documents (ניהול ספקים → מסמכים → הוסף מסמך).
-- Canonical pattern used across the app: is_business_member(business_id) OR is_admin().

DROP POLICY IF EXISTS supplier_documents_select ON supplier_documents;
DROP POLICY IF EXISTS supplier_documents_insert ON supplier_documents;
DROP POLICY IF EXISTS supplier_documents_delete ON supplier_documents;

CREATE POLICY supplier_documents_select ON supplier_documents
  FOR SELECT USING (is_business_member(business_id) OR is_admin());

CREATE POLICY supplier_documents_insert ON supplier_documents
  FOR INSERT WITH CHECK (is_business_member(business_id) OR is_admin());

CREATE POLICY supplier_documents_update ON supplier_documents
  FOR UPDATE USING (is_business_member(business_id) OR is_admin())
  WITH CHECK (is_business_member(business_id) OR is_admin());

CREATE POLICY supplier_documents_delete ON supplier_documents
  FOR DELETE USING (is_business_member(business_id) OR is_admin());
