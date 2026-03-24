Oke! Aku bisa buatkan file **README.md** untukmu. Kamu bisa langsung download atau simpan sebagai file. Berikut versi siap pakai:

---

**File:** `README.md`

```markdown
# Akinator Roblox Middleware API

Middleware Akinator untuk Roblox menggunakan `aki-api`.  
Server ini memungkinkan client (misal Roblox, web, atau mobile) untuk bermain Akinator via REST API.

---

## 🚀 Base URL

Setelah deploy ke Railway / Render:

```

https://YOUR_URL

```

Ganti `YOUR_URL` dengan URL publik server kamu.

---

## 🔑 API Key

Semua endpoint **POST** membutuhkan **API Key** untuk keamanan.  
Header:

```

x-api-key: YOUR_API_KEY

````

> Jangan bagikan API Key secara publik.  
> Untuk testing, bisa menggunakan `.env` variable `API_KEY`.

---

## 📌 Endpoints

### 1. Health Check

- **URL:** `/`  
- **Method:** GET  
- **Headers:** Opsional (tidak perlu API Key)  
- **Body:** Tidak ada

**Response contoh:**
```json
{
  "status": "ok",
  "message": "Akinator Roblox API aktif!",
  "activeSessions": 0
}
````

---

### 2. Start Game

* **URL:** `/start`
* **Method:** POST
* **Headers:**

```http
x-api-key: YOUR_API_KEY
Content-Type: application/json
```

* **Body:**

```json
{
  "sessionId": "player123",
  "region": "en",
  "childMode": false
}
```

**Response contoh:**

```json
{
  "success": true,
  "question": "Is your character real?",
  "answers": ["Yes","No","Don't know","Probably","Probably not"],
  "questionNumber": 1,
  "progress": 0
}
```

---

### 3. Step / Answer Question

* **URL:** `/step`
* **Method:** POST
* **Headers:** Sama seperti `/start`
* **Body:**

```json
{
  "sessionId": "player123",
  "answer": 0
}
```

* **Answer mapping:**

  * 0 = Yes
  * 1 = No
  * 2 = Don't know
  * 3 = Probably
  * 4 = Probably not

**Response contoh:**

```json
{
  "success": true,
  "question": "Is your character female?",
  "answers": ["Yes","No","Don't know","Probably","Probably not"],
  "questionNumber": 2,
  "progress": 15,
  "shouldGuess": false
}
```

---

### 4. Win / Tebak Karakter

* **URL:** `/win`
* **Method:** POST
* **Headers:** Sama
* **Body:**

```json
{
  "sessionId": "player123"
}
```

**Response contoh:**

```json
{
  "success": true,
  "type": "guess",
  "character": "Harry Potter",
  "description": "Fictional character in book/movie",
  "ranking": 1,
  "photo": "https://...jpg",
  "allGuesses": [
    {"name":"Harry Potter","description":"...","ranking":1,"photo":"..."},
    {"name":"Hermione Granger","description":"...","ranking":2,"photo":"..."},
    {"name":"Ron Weasley","description":"...","ranking":3,"photo":"..."}
  ]
}
```

---

### 5. Back / Kembali ke Pertanyaan Sebelumnya

* **URL:** `/back`
* **Method:** POST
* **Headers:** Sama
* **Body:**

```json
{
  "sessionId": "player123"
}
```

**Response contoh:**

```json
{
  "success": true,
  "question": "Is your character real?",
  "answers": ["Yes","No","Don't know","Probably","Probably not"],
  "questionNumber": 1,
  "progress": 0
}
```

---

### 6. Delete Session

* **URL:** `/session/:sessionId`
* **Method:** DELETE
* **Headers:** Sama

**Response contoh:**

```json
{
  "success": true,
  "message": "Sesi dihapus."
}
```

---

## ⚠️ Notes

* Gunakan **sessionId unik per player**
* Jangan panggil `/win` terlalu cepat, tunggu `progress >= 80`
* API mendukung **Redis session** untuk multi-server (production ready)
* Untuk testing di browser, gunakan **Postman / Live Server HTML** karena browser tidak bisa kirim header dari `file://`

---

## 🛠 Testing di Postman / fetch

**Contoh fetch untuk `/start`:**

```js
fetch("https://YOUR_URL/start", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "YOUR_API_KEY"
  },
  body: JSON.stringify({ sessionId:"player123", region:"en", childMode:false })
})
.then(res => res.json())
.then(console.log)
```

---

## 👨‍💻 Recommended

* Simpan API Key di `.env`
* Gunakan **RemoteEvent** jika dipanggil dari Roblox untuk keamanan
* Jangan langsung expose API Key di client Roblox

```

---

Kalau kamu mau, aku bisa sekalian buatkan **versi file zip siap GitHub** yang berisi:

- `server.js`  
- `package.json`  
- `README.md`  
- `.env.example`  

Jadi tinggal clone & deploy langsung ke Railway / Render.  

Apakah mau aku buatkan zip itu juga?
```
