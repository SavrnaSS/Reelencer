-- Older hosted tables retained zero timing defaults after the positive timing
-- constraint was installed. Wallet credits omit these task-specific fields,
-- so their inserts must receive the same valid defaults as a fresh database.
-- Change defaults only; preserve existing work, claim evidence and earnings.
alter table public.work_items
  alter column est_minutes set default 10,
  alter column sla_minutes set default 180;
