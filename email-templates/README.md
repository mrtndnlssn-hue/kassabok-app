# E-postmallar för Supabase Auth

Klistra in mallarna i Supabase: **Authentication → Emails → Templates**.
Varje mall är tvåspråkig (svenska överst, engelska under), så att samma mall fungerar för alla.

| Mall i Supabase | Fil | Ämnesrad (Subject) |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Bekräfta din e-postadress / Confirm your email address |
| Reset password | `reset-password.html` | Återställ ditt lösenord / Reset your password |
| Change email address | `change-email.html` | Bekräfta din nya e-postadress / Confirm your new email address |

Mallarna använder Supabases variabler (`{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`). Ändra dem inte.
Mallarna Magic link, Invite user och Reauthentication används inte av appen.
