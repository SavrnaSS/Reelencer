# Supabase PostgreSQL root certificate

`prod-ca-2021.crt` is the public Supabase root certificate, downloaded over HTTPS from the URL configured in [Supabase Studio](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json):

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Its SHA-256 fingerprint is `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`, and it expires on 2031-04-26.

Set `DATABASE_SSL_CA_FILE=supabase/certs/prod-ca-2021.crt` for migrations, or inject the PEM through `DATABASE_SSL_CA`. The migration runner keeps certificate and hostname verification enabled. Download and verify the replacement certificate through the project's Database SSL settings when Supabase changes its trust chain. This public certificate contains no private key or project credentials.
