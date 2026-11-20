# เอกสารวิศวกรรมการพัฒนา

เอกสารนี้อธิบายสถาปัตยกรรม การไหลของข้อมูล และข้อจำกัดของ Crypto Chart Monitor ทั้งแอปเดสก์ท็อปบน Windows และวิดเจ็ต Android วิธีใช้งานอยู่ที่ [README.md](README.md)

## ขอบเขต

ระบบมีสองผลิตภัณฑ์ที่แชร์แนวคิดเดียวกัน แต่ไม่ได้แชร์โค้ด

| ส่วน | ที่อยู่ | บทบาท |
| --- | --- | --- |
| มอนิเตอร์ Windows | รากโปรเจกต์ | หน้าต่างกราฟหลายบาน ชิดขอบขวา เฝ้าดูคริปโต หุ้น และทอง |
| วิดเจ็ต Android | `app_androind` | วิดเจ็ตหน้าโฮมของ XRPUSDT และ BTCUSDT เท่านั้น |

เดสก์ท็อปเป็น Electron 33 กับ TradingView Lightweight Charts 5 วิดเจ็ตเป็นแอป Kotlin ที่วาดกราฟเองเพราะ RemoteViews โฮสต์ไลบรารีกราฟไม่ได้

## สถาปัตยกรรมเดสก์ท็อป

โปรเซสหลักเป็นเจ้าของหน้าต่าง เครือข่าย REST และไฟล์คอนฟิก แต่ละหน้าต่างเป็น renderer คนละตัว คุยกับหลักผ่าน preload เท่านั้น

```text
renderer (src/index.html)
  Lightweight Charts, WebSocket Binance, เมนู, เครื่องมือวัด
        |  window.monitor.*
preload.js  contextBridge
        |  IPC
main.js
  BrowserWindow, dock, tray, config
  REST Binance และ Yahoo
```

`contextIsolation` เปิด, `nodeIntegration` ปิด, `sandbox` เปิด ตัวเรนเดอร์เรียกได้เฉพาะ API ใน `preload.js` การดึง kline ทาง REST เกิดในโปรเซสหลัก เพื่อไม่ให้หน้า `file://` ติด CORS และเพื่อตรวจสัญลักษณ์กับช่วงเวลาที่หน้าต่างนั้นมีสิทธิ์ขอ

หน้าเว็บมี Content-Security-Policy ใน `src/index.html`

- `script-src 'self'` ไม่มี `unsafe-eval`
- `style-src` อนุญาต `'unsafe-inline'` เพราะ Lightweight Charts สร้างแท็ก `style` เอง
- `connect-src` เปิดเฉพาะ WebSocket ของ Binance

สคริปต์ของกราฟถูกคัดลอกมาไว้ที่ `src/lightweight-charts.standalone.js` CSP ของหน้า `file://` มอง `../node_modules` เป็นคนละต้นทาง

แอปใช้ single-instance lock ของ `appId` `crypto.monitor.charts` อินสแตนซ์ที่สองไม่สร้างหน้าต่างใหม่ แต่สั่งให้อินสแตนซ์แรกโชว์ทุกรายการ ไฟล์ `.exe` กับ `npm start` ใช้ userData เดียวกัน จึงแย่งล็อกกัน

## โมเดลรายการเฝ้าดู

รหัสรายการคือ `source:symbol` เช่น `binance:XRPUSDT` และ `yahoo:GC=F` รายการเริ่มต้นคือ XRP กับ BTC สูงสุด 12 รายการ และต้องเหลืออย่างน้อย 1 รายการ

สัญลักษณ์ถูกทำให้เป็นตัวพิมพ์ใหญ่ก่อนบันทึก

- Binance: ถ้าไม่ได้ลงท้ายด้วย `USDT` จะต่อให้ และต้องตรง `^[A-Z0-9]{5,20}$`
- Yahoo: ต้องตรง `^[A-Z0-9^=.\-]{1,16}$` จึงรับ `GC=F`, `GLD`, `^GSPC`, `EURUSD=X`

ก่อนสร้างหน้าต่าง โปรเซสหลักขอแท่ง `1d` จำนวน 2 แท่ง ถ้าแหล่งข้อมูลตอบไม่สำเร็จ รายการจะไม่ถูกเพิ่ม ของที่มีอยู่แล้วจะถูกโชว์แทนการสร้างซ้ำ

แหล่งข้อมูล

| ชนิด | แหล่ง | ตัวอย่าง | อัปเดตสด |
| --- | --- | --- | --- |
| คริปโต | Binance REST + WebSocket | `SOL` กลายเป็น `SOLUSDT` | WebSocket และสำรองด้วย REST ทุก 10 วินาที |
| หุ้น | Yahoo chart API | `AAPL` | REST ทุก 10 วินาที ไม่มีซ็อกเก็ต |
| ทอง | Yahoo หรือ Binance | `GC=F`, `GLD`, `PAXGUSDT` | ตามแหล่งของสัญลักษณ์นั้น |

`XAUUSD=X` ของ Yahoo ใช้ไม่ได้ ทองที่ใช้ได้คือฟิวเจอร์ส `GC=F`, ETF `GLD`, หรือโทเคน `PAXGUSDT`

Yahoo ไม่มีช่วง 3 นาที, 2 ชั่วโมง และ 4 ชั่วโมงตรง ๆ ระบบดึงช่วงที่ใกล้ที่สุดแล้วรวมแท่งใน `bucketRows` ช่วงมองย้อนหลังถูกจำกัดตามที่ Yahoo ให้ เช่น 1 นาทีดูได้ 7 วัน และ 5–30 นาทีดูได้ 59 วัน ผลลัพธ์ถูกแปลงเป็นแถวรูป Binance `[openMs, open, high, low, close]` เพื่อใช้ `parseKlines` ตัวเดียวกัน

Binance ลอง `api.binance.com` ก่อน แล้วจึง `data-api.binance.vision` WebSocket ลอง `stream.binance.com` แล้วจึง `data-stream.binance.vision` แต่ละคำขอ REST ถูกตัดที่ 12 วินาที

## การจัดหน้าต่าง

หน้าต่างไม่มีกรอบ ความสูงแถบหัวคือ 30 พิกเซล ขนาดที่บันทึกเป็นขนาด content เพราะสร้างด้วย `useContentSize`

หน้าต่างมีสองโหมด

- **ชิดขอบขวา** ค่าเริ่มต้น แกน X ถูกล็อกที่ขอบขวาของ work area จึงไม่ทับแถบงาน แต่ละบานเก็บความกว้างและความสูงของตัวเอง บานที่กว้างกว่าจะยื่นไปทางซ้าย บานทั้งหมดเรียงในแนวตั้งโดยไม่มีช่องว่าง ลากแถบหัวแล้วส่งค่า `screenY` ผ่าน IPC ทั้งกองจึงเลื่อนพร้อมกัน
- **อิสระ** เก็บตำแหน่งเอง ลากได้ทั่วจอ และไม่อยู่ในกอง

การจัดวางอยู่ใน `layoutDocked` มีธง `layingOut` และ `ignoreLayout` ประมาณ 250 มิลลิวินาที เพื่อไม่ให้ `setContentBounds` ย้อนมากระตุ้น `resized` ซ้ำ ถ้าขนาดเปลี่ยนไม่เกิน 1 พิกเซลจะไม่สั่งย้ายซ้ำ

ช่วงแนวตั้งของกองถูกหนีบให้อยู่ใน work area ถ้ากองสูงกว่าจอ จะเลื่อนขึ้นเลยขอบบนได้เท่าที่จำเป็น เปลี่ยนความละเอียดจอแล้วจัดวางใหม่

ปุ่มปิดและเมนูซ่อนหน้าต่างไม่ได้ทำลาย `BrowserWindow` กราฟกับซ็อกเก็ตจึงยังอยู่ ถาดระบบมีช่องติ๊กของแต่ละรายการ ดับเบิลคลิกถาดเปิดทั้งหมด ถ้าคอนฟิกบันทึกว่าทุกรายการถูกซ่อน ตอนเปิดแอปจะโชว์ทั้งหมด เพื่อไม่ให้แอปหายไปจากจอ

## กราฟและตัวชี้วัด

ไลบรารีวาดแท่งด้วยสีเริ่มต้นของ TradingView คือ `#26a69a` ขึ้น และ `#ef5350` ลง SMA 5 เป็นสีส้ม SMA 200 เป็นสีขาว ราคาและเปอร์เซ็นต์บนหัวเป็นเขียว `#00e676` หรือแดง `#ff5252`

เปอร์เซ็นต์ของวันคือราคาล่าสุดเทียบราคาเปิดของแท่ง `1d` ซึ่งเป็นแท่ง UTC 00:00 ไม่ใช่เปอร์เซ็นต์ของแท่งไทม์เฟรมที่กำลังดู

ตอนเปิดกราฟขอ 699 แท่ง คือ 500 แท่งที่ตั้งใจเก็บบวก 199 แท่งสำหรับอุ่น SMA 200 มุมมองแรกแสดง 20 แท่งล่าสุด ส่วนที่เหลือเลื่อนดูได้ เมนูรีเซ็ตกลับมาที่ 20 แท่งนี้

เมื่อช่วงที่มองเห็นเข้าใกล้ขอบซ้ายกว่า 40 แท่ง ระบบขอประวัติเพิ่มทีละ 1000 แท่ง โดยส่ง `endTime` เป็นเวลาเปิดของแท่งแรกที่โหลดไว้ลบ 1 มิลลิวินาที แล้วเลื่อน logical range ตามจำนวนแท่งที่แทรกด้านหน้า เพื่อไม่ให้ภาพกระโดด ถ้าหน้าที่ได้สั้นกว่า 1000 ถือว่าประวัติหมด

แท่งสดใช้ `series.update` ไม่ตัดประวัติที่เลื่อนโหลดมา `shiftVisibleRangeOnNewBar` เป็นค่าเริ่มต้นของไลบรารี จึงติดขอบขวาเมื่อผู้ใช้ดูแท่งล่าสุด และอยู่กับที่เมื่อเลื่อนย้อนหลัง

เครื่องมือวัดใช้ Shift ร่วมกับลากคลิกซ้าย แสดงเปอร์เซ็นต์ ส่วนต่างราคา จำนวนแท่ง และระยะเวลา ผลค้างจนคลิกอื่นหรือกด Escape

## คอนฟิก

ไฟล์อยู่ที่ `%APPDATA%\crypto-chart-monitor\monitor-config.json` เขียนแบบหน่วง 150 มิลลิวินาที

```json
{
  "dockTop": 754,
  "dockWidth": 300,
  "dockHeight": 300,
  "watchlist": [
    { "id": "binance:XRPUSDT", "source": "binance", "symbol": "XRPUSDT", "label": "XRP" }
  ],
  "windows": {
    "binance:XRPUSDT": {
      "interval": "15m",
      "width": 293,
      "height": 323,
      "independent": false,
      "alwaysOnTop": true,
      "hidden": false,
      "x": null,
      "y": null
    }
  }
}
```

`dockWidth` กับ `dockHeight` เป็นขนาดเริ่มต้นของรายการใหม่ แต่ละบานที่ชิดขอบใช้ `windows[id].width` และ `height` ของตัวเอง คอนฟิกรุ่นเก่าที่มี `dockSize` และสถานะที่รากคีย์ `XRPUSDT` / `BTCUSDT` ถูกอ่านได้ครั้งเดียวแล้วเขียนเป็นโครงใหม่

ช่วงเวลาที่อนุญาตคือ `1m 3m 5m 15m 30m 1h 2h 4h 1d` ความกว้างหน้าต่างอยู่ระหว่าง 200 ถึง 1600 ความสูงกราฟในเมนูอยู่ระหว่าง 200 ถึง 900

## บิลด์ Windows

`npm start` เปิด Electron จากซอร์ส `npm run build` ทำสองขั้น

1. `scripts/make-icon.js` ย่อ `icon.png` ให้พอดีในภาพ 256×256 แล้วเขียน `build/icon.png`
2. electron-builder สร้าง portable ที่ `dist\CryptoChartMonitor.exe`

ตอนรัน โปรเซสหลักห่อ `icon.png` เป็น ICO แบบ PNG-in-ICO ที่ userData สำหรับไอคอนหน้าต่าง และย่อเป็น 32×32 สำหรับถาด `build.bat` ตั้ง `CSC_IDENTITY_AUTO_DISCOVERY=false` จึงไม่เซ็นชื่อ ไฟล์จึงขึ้น SmartScreen ได้

ชุดที่แพ็กมี `main.js`, `preload.js`, `icon.png`, `src/**` และ `package.json` ไม่มี `node_modules` ของเครื่องมือบิลด์

## วิดเจ็ต Android

`applicationId` คือ `crypto.monitor.widgets` ใช้ compile/target SDK 34, minSdk 26, Kotlin 1.9 และ AGP 8.5

`CryptoWidgetProvider` รับการอัปเดตของวิดเจ็ต `WidgetUpdater` ขอ kline จาก Binance แล้วให้ `ChartBitmap` วาดเป็นบิตแมป ขนาดบิตแมปถูกจำกัดไม่ให้ `กว้าง × สูง × 4` เกินงบของ Binder `RefreshWorker` ของ WorkManager ทำงานเป็นรอบประมาณ 15 นาที และผู้ใช้แตะวิดเจ็ตเพื่อรีเฟรชได้ `updatePeriodMillis` ของวิดเจ็ตคือ 30 นาที เป็นเพดานของระบบ

`WidgetConfigureActivity` ให้เลือกได้เฉพาะ XRPUSDT กับ BTCUSDT และช่วงเวลาใน `Markets.kt` วิดเจ็ตยังไม่มีความกว้างสูงแยกตามเดสก์ท็อป และยังไม่มีหุ้นหรือทอง

การทำให้ชุด release แคบลง

- `isMinifyEnabled` และ `isShrinkResources` เปิด, `isDebuggable` ปิด
- `usesCleartextTraffic` ปิด และ network security config เชื่อ CA ของระบบเท่านั้น
- `allowBackup` ปิด ทั้งกติกา backup และ data extraction ไม่รวมโดเมนใด
- เซ็นด้วยคีย์สโตร์ `app_androind/release.keystore` alias `crypto-monitor` รหัสอยู่ใน `keystore.properties` ทั้งสองไฟล์ถูก gitignore
- `build.bat` สร้างคีย์สโตร์เฉพาะเมื่อยังไม่มี การสร้างใหม่จะทำให้ติดตั้งทับแอปเดิมไม่ได้

JDK ที่ใช้บิลด์คือ JBR 17 ของ Android Studio เพราะ Java ของระบบเป็นรุ่น 8 และไม่อยู่บน PATH SDK อยู่ที่ `%LOCALAPPDATA%\Android\Sdk` ไฟล์ติดตั้งคือ `app_androind\app\build\outputs\apk\release\app-release.apk`

## แผนที่ไฟล์

| ไฟล์ | หน้าที่ |
| --- | --- |
| `main.js` | หน้าต่าง กองชิดขอบ ถาด คอนฟิก REST |
| `preload.js` | สะพาน IPC ที่เรนเดอร์เรียกได้ |
| `src/renderer.js` | กราฟ ซ็อกเก็ต เมนู เครื่องมือวัด |
| `src/indicators.js` | SMA, แปลง kline, ทศนิยมราคา |
| `src/index.html`, `src/style.css` | โครงหน้าและ CSP |
| `scripts/make-icon.js` | ไอคอนสำหรับตัวติดตั้ง |
| `start.bat`, `build.bat` | เปิดและบิลด์บน Windows |
| `app_androind/app/src/main/java/crypto/monitor/widgets/` | วิดเจ็ต การดึงราคา และการวาด |

## ข้อจำกัดที่ตั้งใจไว้

- รายการ Yahoo ไม่มีสตรีมสด ความหน่วงตามรอบโพล 10 วินาที และช่วงสั้น ๆ ถูกจำกัดด้วยประวัติที่ Yahoo ให้
- หน้าต่างที่ชิดขอบเลื่อนพร้อมกันในแนวตั้ง แต่ขนาดไม่ถูกบังคับให้เท่ากัน
- ซ่อนหน้าต่างไม่ได้คืนหน่วยความจำของเรนเดอร์ เพราะตั้งใจให้กราฟกับซ็อกเก็ตค้างไว้
- แอป Android กับเดสก์ท็อปคนละคอนฟิก คนละชุดสัญลักษณ์
- ไฟล์ `.exe` ที่แจกไม่ได้เซ็นชื่อ ต้องบิลด์ใหม่ทุกครั้งที่แก้ `main.js` หรือ `src` เพราะชุดใน `dist` เป็นภาพนิ่งของซอร์สตอนบิลด์
