# Add real phone calls to your Voicemate server (Option B)

Tested against the handoff `server.py`: it reuses your existing `lookup_caller()` and `triage_call()`, so the dashboard doesn't change. A phone call lands in the same queue the browser calls do.

## 1. Add the endpoint (2 min)
Paste everything in `vapi_tools_patch.py` at the **very end** of your `server.py`.
uvicorn with `--reload` picks it up; otherwise restart the server.

If you renamed `lookup_caller`, `triage_call`, `LookupIn` or `TriageIn`, change the names in the patch to match.

## 2. Tunnel (2 min)
```bash
brew install cloudflared            # if you don't have it
cloudflared tunnel --url http://localhost:8000
```
Copy the `https://….trycloudflare.com` address. Keep that window open.

## 3. Connect Vapi (1 min)
Put these in a `.env` next to `setup_vapi_tools.py` (or in the folder above it), or `export` them:
```
VAPI_API_KEY=...          # private key (Vapi → API Keys)
ASSISTANT_ID=...
VAPI_PHONE_NUMBER_ID=...
```
Then:
```bash
python3 setup_vapi_tools.py https://YOUR-TRYCLOUDFLARE-URL
```
This updates the assistant (the prompt, the 3 questions in data order, the `lookup_caller` and `triage_call` tools pointing at `/vapi/tools`) and attaches the phone number. It prints the number to call.
**Rerun it whenever cloudflared restarts** (the address changes).

## 4. Test
Call the number from a phone. The agent greets you, asks: 1) What type of account is this? 2) What specifically happened? 3) What went wrong?, then says "One moment while I place you in line." The row slides into the dashboard, and the agent tells you your place in line and the wait.

## Notes
- `triage_call` waits up to 45 s for Adaption plus scoring. If it's slower, the agent falls back to "you're in the callback line."
- Each test call uses Vapi credits. Only record teammates (California consent law).
- If step 3 prints an error, it retries automatically without the optional fields. Vapi's error text names any field it rejects.
