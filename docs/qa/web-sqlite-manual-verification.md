# Web SQLite Runtime Manual Verification Guide

> **Current Status: UNVERIFIED**  
> *Notice: While `npx expo export -p web` succeeds and server headers are configured, web SQLite runtime persistence via IndexedDB / SQLite WASM remains UNVERIFIED until physically executed in a desktop browser.*

---

## 1. Command to Serve the Exported Application

The static export requires Cross-Origin-Opener-Policy (COOP) and Cross-Origin-Embedder-Policy (COEP) headers to enable `SharedArrayBuffer` for SQLite WASM and OPFS/IndexedDB.

From the repository root (`D:\Friday\friday-amanah`):

```bash
cd mobile
npx expo export -p web -c
npx serve dist -l 3000 --cors
```

*Note: For strict COOP/COEP testing, use the local development proxy or custom headers server:*
```bash
# Alternative Node server injecting COOP/COEP headers:
node -e "
const http = require('http');
const fs = require('fs');
const path = require('path');
const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  let filePath = path.join(__dirname, 'dist', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath)) filePath = path.join(__dirname, 'dist', 'index.html');
  res.writeHead(200);
  fs.createReadStream(filePath).pipe(res);
});
server.listen(3000, () => console.log('Serving with COOP/COEP on http://127.0.0.1:3000'));
"
```

---

## 2. Browser URL

Open a modern browser (Google Chrome 114+ or Firefox 115+ recommended) and navigate to:

```text
http://127.0.0.1:3000
```

---

## 3. Create-Account Steps

1. Wait for the database startup gate to complete (splash spinner disappears).
2. Navigate to the **Accounts** tab (`/accounts`).
3. Tap the **+** (Add Account) button in the header.
4. In the modal:
   - Enter Name: `Primary Cash`
   - Select Type: `Cash`
   - Enter Initial Balance: `5000.00`
   - Save the account.
5. Verify `Primary Cash` appears in the list with `৳5,000.00`.
6. Add a second account:
   - Name: `Bank Savings`
   - Type: `Bank`
   - Initial Balance: `10000.00`
   - Save the account.
7. Verify total net balance shows `৳15,000.00`.

---

## 4. Create-Transaction Steps

1. Tap the floating **+** button in the bottom tab bar to open the transaction modal (`/modal`).
2. Verify:
   - Type selector defaults to `Expense`.
   - Date defaults to current local date (`YYYY-MM-DD`).
   - Time defaults to current local time (`HH:MM`).
   - Formatted date & time preview shows correctly in the active language (English or Bengali).
3. Enter Amount: `150.00`.
4. Select Category: `Food & Groceries`.
5. Select Account: `Primary Cash`.
6. Optional Note: Enter `Weekly vegetables`.
7. Tap **Save**.
8. Verify redirect to Transactions feed, showing `Weekly vegetables` for `-৳150.00`.
9. Navigate to Accounts tab: verify `Primary Cash` balance is now `৳4,850.00`.

---

## 5. Reload Persistence Check

1. Hard-reload the browser tab (`Ctrl + F5` or `Cmd + Shift + R`).
2. Verify the application reboots through the database gate without errors.
3. Check Accounts tab:
   - `Primary Cash` is still present with balance `৳4,850.00`.
   - `Bank Savings` is still present with balance `৳10,000.00`.
4. Check Transactions tab:
   - The `Weekly vegetables` expense is intact with category and timestamp.

---

## 6. Transfer Check

1. Tap **+** to open the transaction modal.
2. Select transaction type: `Transfer`.
3. Set Source Account: `Primary Cash`.
4. Set Destination Account: `Bank Savings`.
5. Enter Amount: `1000.00`.
6. Enter Note: `Savings deposit`.
7. Tap **Save**.
8. Navigate to Transactions feed:
   - Verify that the transfer appears as **one single logical list item**:  
     `Primary Cash → Bank Savings` with amount `৳1,000.00`.
   - Verify it does **NOT** appear as two separate, duplicate rows.
9. Navigate to Accounts tab:
   - `Primary Cash` shows `৳3,850.00` (-1,000).
   - `Bank Savings` shows `৳11,000.00` (+1,000).
10. Test Undo / Restore:
    - Swipe or tap delete on the transfer in the Transactions tab.
    - Confirm deletion.
    - Verify both accounts revert to `৳4,850.00` and `৳10,000.00`.
    - Tap **Undo** on the floating snackbar before it dismisses (6s).
    - Verify the transfer is restored and balances update back atomically.

---

## 7. Browser Console Error Check

1. Open Browser DevTools (`F12`) -> **Console** tab.
2. Filter for `Error` or `Warning`.
3. Verify:
   - Zero uncaught exceptions.
   - Zero SQLite WASM initialization failures or missing symbol errors.
   - Zero missing translation warnings.
   - Zero unhandled promise rejections.

---

## 8. IndexedDB Persistence Check

1. In DevTools, open the **Application** (or **Storage**) tab.
2. Under **Storage** -> **IndexedDB**:
   - Locate the SQLite database entry (typically `/barakah.db` or `sqlite3-wa-sqlite-...` / `expo-sqlite`).
   - Inspect the object stores to verify pages or filesystem blocks are persisted.
3. Close the browser tab entirely, reopen a new tab to `http://127.0.0.1:3000`, and confirm data is still loaded.

---

## QA Certification Sign-Off

- [ ] Step 1: Export and headers verified
- [ ] Step 2: Browser opened
- [ ] Step 3: Accounts created
- [ ] Step 4: Transactions created with editable date/time/note
- [ ] Step 5: Reload persistence verified
- [ ] Step 6: Single-item paired transfer presentation & atomic undo verified
- [ ] Step 7: Console errors clear
- [ ] Step 8: IndexedDB persistence confirmed

*Tester Name:* _________________________  
*Date:* _________________________  
*Result (PASS / FAIL):* _________________________
