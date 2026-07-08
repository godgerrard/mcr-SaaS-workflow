-- Phase 5: assets — one private bucket, path-scoped RLS
-- Path convention: {org_id}/{project_id}/{stage}/{filename}
-- (spec §6 amended: bucket-per-org needs the admin API, which prod deliberately lacks;
--  isolation is enforced by RLS on the path prefix using the same app.* helpers as tables)

insert into storage.buckets (id, name, public) values ('assets', 'assets', false);

-- ceo/producer: all stages of their org; crew: own stage only.
-- No update/delete policies: assets are immutable in the pilot (default deny).
create policy assets_select on storage.objects for select to authenticated
  using (
    bucket_id = 'assets'
    and (
      app.my_role(((storage.foldername(name))[1])::uuid) in ('ceo','producer')
      or (
        app.my_role(((storage.foldername(name))[1])::uuid) = 'crew'
        and (storage.foldername(name))[3] = app.my_stage(((storage.foldername(name))[1])::uuid)::text
      )
    )
  );

create policy assets_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assets'
    and (
      app.my_role(((storage.foldername(name))[1])::uuid) in ('ceo','producer')
      or (
        app.my_role(((storage.foldername(name))[1])::uuid) = 'crew'
        and (storage.foldername(name))[3] = app.my_stage(((storage.foldername(name))[1])::uuid)::text
      )
    )
  );
