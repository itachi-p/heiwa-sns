-- 投稿に画像1枚（Storage パス参照）
alter table public.posts
  add column if not exists image_storage_path text;

comment on column public.posts.image_storage_path is
  'Supabase Storage bucket post-images のオブジェクトパス（{user_id}/{post_id}.{ext}）';

insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "post_images_select_all" on storage.objects;
create policy "post_images_select_all"
on storage.objects for select
using (bucket_id = 'post-images');

drop policy if exists "post_images_insert_own" on storage.objects;
create policy "post_images_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'post-images'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "post_images_update_own" on storage.objects;
create policy "post_images_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'post-images'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'post-images'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "post_images_delete_own" on storage.objects;
create policy "post_images_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'post-images'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);
