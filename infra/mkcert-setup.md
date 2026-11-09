# Local Development TLS Parity Setup (`mkcert`)

This runbook establishes production-identical origin parity on local workstations and physical mobile testing devices (iOS Safari and Android Chrome).

## Why This Is Required
The ADUN Attendance system relies on **first-party HttpOnly cookies** (`adun_trusted_device`) for secure device binding. Mobile Safari (iOS WebKit ITP) blocks or expires cross-site cookies and unverified local origins. By serving under `https://adun.local` with a trusted CA, local mobile devices behave identically to production.

---

## 1. Install `mkcert`
### On Windows (via Chocolatey / Scoop):
```powershell
choco install mkcert
# or: scoop install mkcert
```

### On macOS (via Homebrew):
```bash
brew install mkcert
brew install nss # if using Firefox
```

---

## 2. Generate Local Certificates
In the repository root:
```bash
mkdir -p infra/certs
cd infra/certs
mkcert -install
mkcert adun.local admin.adun.local localhost 127.0.0.1 ::1
mv adun.local+4.pem adun.local.pem
mv adun.local+4-key.pem adun.local-key.pem
```

---

## 3. Configure Local Hosts Resolution
Add the following entries to your operating system's hosts file:
- **Windows**: `C:\Windows\System32\drivers\etc\hosts`
- **macOS / Linux**: `/etc/hosts`

```text
127.0.0.1  adun.local
127.0.0.1  admin.adun.local
```

---

## 4. Trusting the Root CA on Physical Mobile Devices

### iOS (iPhone / iPad):
1. Locate the root certificate on your computer:
   ```bash
   mkcert -CAROOT
   ```
   (Find `rootCA.pem`).
2. Transfer `rootCA.pem` to your iPhone (via AirDrop, email, or a local HTTP server).
3. Open the file on iOS to download the configuration profile.
4. Go to **Settings -> Profile Downloaded -> Install**.
5. Go to **Settings -> General -> About -> Certificate Trust Settings**.
6. Under "Enable full trust for root certificates", toggle ON the mkcert root certificate.
7. Connect phone to the same Wi-Fi as your development machine and map DNS or access via workstation LAN IP.

### Android:
1. Transfer `rootCA.pem` to your Android device.
2. Go to **Settings -> Security -> Encryption & Credentials -> Install a Certificate -> CA Certificate**.
3. Select `rootCA.pem` and confirm install.

---

## 5. Running the Local Parity Stack
Start the local reverse proxy container:
```bash
docker-compose -f docker-compose.local.yml up -d
```
You can now access:
- Student PWA: `https://adun.local`
- Admin Portal: `https://admin.adun.local`
- First-party Edge Functions: `https://adun.local/api/*`
