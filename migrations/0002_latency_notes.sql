-- Persist parser notes (blank_latency / negative_latency / unknown unit)
-- so ingest decisions stay auditable after the request ends.
ALTER TABLE checks ADD COLUMN latency_notes TEXT;
