-- Tutup celah: client bisa menulis sendiri file_size_bytes di scan_documents,
-- dan angka itu dipercaya sebagai dasar perhitungan kuota R2.
--
-- Rantai eksploitasinya:
--   1. User Basic meng-insert/update barisnya sendiri dengan
--      file_size_bytes = 1000000000000 (policy lama mengizinkan, asal
--      owner_id = auth.uid()).
--   2. generate-upload-url membaca angka itu sebagai `replacing`, sehingga
--      growth = incoming - replacing selalu negatif dan fitsInQuota() lolos
--      untuk berapa pun ukuran unggahan.
--   3. confirm-upload menghitung bytes_used = max(0, used - previousSize +
--      size) yang juga jatuh ke 0.
--   Hasilnya: penyimpanan R2 tanpa batas di akun Basic, dan indikator kuota
--   selamanya menunjukkan 0.
--
-- Perbaikannya bukan memvalidasi angkanya, tapi mencabut hak tulisnya. Client
-- memang tidak pernah menulis tabel ini: satu-satunya penulis adalah
-- confirm-upload dan delete-backup, yang memakai service role dan melewati
-- RLS. Ini menyamakan scan_documents dengan storage_usage & referral_events
-- yang memang sejak awal hanya punya policy SELECT.
--
-- Policy SELECT dibiarkan apa adanya — listCloudBackups() di client membacanya
-- langsung, dan itu memang aman.

drop policy if exists "scan_documents_insert_own" on public.scan_documents;
drop policy if exists "scan_documents_update_own" on public.scan_documents;
drop policy if exists "scan_documents_delete_own" on public.scan_documents;
