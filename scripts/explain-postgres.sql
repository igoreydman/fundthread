-- Disposable benchmark only: run with psql -X -v ON_ERROR_STOP=1 -f ...
-- Uses an isolated transaction; all synthetic rows and ANALYZE changes roll back.
BEGIN;
SET LOCAL search_path TO fundthread,pg_catalog;
INSERT INTO funds
SELECT 'bench-f-'||n,'Benchmark fund '||n,'BENCH-'||n,100000000,'2026-01-01'::date,'2026-12-31'::date,''
FROM generate_series(1,100) n;
INSERT INTO documents
SELECT 'bench-d-'||n,'benchmark.pdf','application/pdf',md5('benchmark-'||n)||md5('benchmark2-'||n),convert_to('%PDF-1.7 synthetic benchmark','UTF8')
FROM generate_series(1,10000) n;
INSERT INTO expenses(id,document_id,current_revision)
SELECT 'bench-e-'||n,'bench-d-'||n,1 FROM generate_series(1,10000) n;
INSERT INTO reviews(expense_id,revision,merchant,claimant,purpose,expense_date,total,eligible,reviewed)
SELECT 'bench-e-'||n,1,'Synthetic merchant','Synthetic claimant','Index experiment','2026-11-01'::date,100,100,true
FROM generate_series(1,10000) n;
INSERT INTO review_allocations
SELECT 'bench-e-'||n,1,'bench-f-'||((n%100)+1),100 FROM generate_series(1,10000) n;
INSERT INTO approvals(expense_id,revision,approver,reference)
SELECT 'bench-e-'||n,1,'Synthetic','BENCH' FROM generate_series(1,10000) n WHERE n%2=0;
INSERT INTO payments(id,expense_id,amount,reference,payment_date)
SELECT 'bench-p-'||n,'bench-e-'||n,50,'BENCH-P','2026-11-02'::date FROM generate_series(1,10000) n;
INSERT INTO extraction_runs(expense_id,payload)
SELECT 'bench-e-'||((n%10000)+1),'{"engine":"synthetic benchmark"}'::jsonb FROM generate_series(1,30000) n;
ANALYZE funds; ANALYZE documents; ANALYZE expenses; ANALYZE reviews;
ANALYZE review_allocations; ANALYZE approvals; ANALYZE payments; ANALYZE extraction_runs;
\echo 'Hash duplicate lookup'
EXPLAIN (ANALYZE,BUFFERS) SELECT id FROM documents WHERE hash=md5('benchmark-42')||md5('benchmark2-42');
\echo 'Fund usage join'
EXPLAIN (ANALYZE,BUFFERS)
SELECT sum(a.amount)::bigint FROM review_allocations a
JOIN expenses e ON (e.id,e.current_revision)=(a.expense_id,a.revision)
JOIN approvals ap ON (ap.expense_id,ap.revision)=(e.id,e.current_revision)
WHERE a.fund_id='bench-f-43';
\echo 'Payment sum using expense prefix of unique index'
EXPLAIN (ANALYZE,BUFFERS) SELECT sum(amount)::bigint FROM payments WHERE expense_id='bench-e-42';
\echo 'Latest OCR artifact'
EXPLAIN (ANALYZE,BUFFERS) SELECT payload FROM extraction_runs WHERE expense_id='bench-e-42' ORDER BY id DESC LIMIT 1;
\echo 'Review history'
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM reviews WHERE expense_id='bench-e-42' AND revision>0 ORDER BY revision DESC;
\echo 'Expense ordering'
EXPLAIN (ANALYZE,BUFFERS) SELECT id FROM expenses ORDER BY created_at DESC,id;
ROLLBACK;
