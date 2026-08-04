-- ============================================================
-- Restrict General Secretary reports/documents to the General
-- Secretary and the General Overseer only.
--
-- Right now the app only LINKS to church_documents from
-- general-secretary.html, but without a real RLS policy any
-- logged-in member could still read the table directly via the
-- Supabase API. This locks it down at the database level.
-- ============================================================

alter table church_documents enable row level security;

drop policy if exists "church_documents_select" on church_documents;
create policy "church_documents_select" on church_documents
for select using (
  exists (
    select 1 from members m
    where m.id = auth.uid()
      and (m.role = 'admin' or m.leadership_role = 'general_secretary')
  )
);

drop policy if exists "church_documents_write" on church_documents;
create policy "church_documents_write" on church_documents
for all using (
  exists (
    select 1 from members m
    where m.id = auth.uid()
      and (m.role = 'admin' or m.leadership_role = 'general_secretary')
  )
) with check (
  exists (
    select 1 from members m
    where m.id = auth.uid()
      and (m.role = 'admin' or m.leadership_role = 'general_secretary')
  )
);
