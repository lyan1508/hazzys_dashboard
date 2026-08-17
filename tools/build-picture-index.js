#!/usr/bin/env node
/**
 * LẬP BẢNG TRA ẢNH SẢN PHẨM  →  picture-index.json
 *
 * Thư mục PICTURE trên Drive đặt tên tệp đúng bằng "mã style + mã màu"
 * (HUTS5B411BK.webp), trùng khớp mã SKU trong dữ liệu bán hàng. Nhưng Drive chỉ
 * mở tệp theo ID chứ không theo tên, nên dashboard cần một bảng tra tên → ID.
 *
 * Thư mục đang ở chế độ công khai, mà bản xem thư mục nhúng của Drive
 * (embeddedfolderview) là một trang HTML tĩnh liệt kê đủ tên lẫn ID — lấy được
 * bằng một lượt tải thường, không cần khoá API, không cần Apps Script.
 * Trình duyệt thì không tự tải trang đó được (khác tên miền, Drive không mở
 * CORS), nên việc dò danh sách làm sẵn ở đây rồi kết quả đi kèm dashboard.
 *
 * CHẠY:  node tools/build-picture-index.js
 * Chạy lại mỗi khi thêm ảnh mới vào thư mục.
 */

const fs = require('fs');
const path = require('path');

const FOLDER_ID = '14NWZ9x6AGbK1LuRoF0kSck821KN02pe9';
const OUT_FILE = path.join(__dirname, '..', 'picture-index.json');
const LIST_URL = `https://drive.google.com/embeddedfolderview?id=${FOLDER_ID}#list`;

// id="entry-<ID>" luôn đứng trước <div class="flip-entry-title">TÊN</div> trong
// cùng một khối. Dùng [^]*? (không tham lam) để không nuốt sang khối kế tiếp.
const ENTRY_RE = /id="entry-([^"]+)"[^]*?flip-entry-title">([^<]+)</g;
const IMAGE_RE = /\.(webp|jpe?g|png)$/i;

async function main() {
  const res = await fetch(LIST_URL);
  if (!res.ok) throw new Error(`Drive trả về HTTP ${res.status}`);
  const html = await res.text();

  const index = {};
  let skipped = 0;
  for (const [, id, rawName] of html.matchAll(ENTRY_RE)) {
    const name = rawName.trim().toUpperCase();
    if (!IMAGE_RE.test(name)) { skipped++; continue; }
    index[name] = id;
  }

  const names = Object.keys(index);
  if (!names.length) {
    throw new Error(
      'Không đọc được tệp nào. Kiểm tra thư mục có đang để "bất kỳ ai có ' +
      'đường liên kết → người xem" hay không.'
    );
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(index), 'utf8');
  names.sort();
  console.log(`Đã ghi ${names.length} ảnh vào ${path.relative(process.cwd(), OUT_FILE)}`);
  console.log(`  đầu: ${names[0]}`);
  console.log(`  cuối: ${names[names.length - 1]}`);
  if (skipped) console.log(`  bỏ qua ${skipped} mục không phải ảnh`);
}

main().catch((err) => {
  console.error('Lỗi:', err.message);
  process.exit(1);
});
