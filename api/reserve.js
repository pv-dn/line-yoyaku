/**
 * 予約受付 → 店舗LINEへ通知（Messaging API）
 *
 * 必要な環境変数（Vercel）:
 * - LINE_CHANNEL_ACCESS_TOKEN … Messaging API のチャネルアクセストークン（長期）
 * - SHOP_LINE_USER_ID … 店舗オーナーの LINE ユーザーID
 * - NOTIFY_CUSTOMER … "true" なら予約者にも確認メッセージ（任意）
 */

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function badRequest(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

function buildShopMessage(body) {
  const lines = [
    '【新規予約】',
    body.storeName || '予約アプリ',
    '',
    `メニュー: ${body.menuName || '-'}`,
    `料金: ${body.price || '-'}`,
    `日時: ${body.dateLabel || body.date || '-'} ${body.time || ''}`,
    `お名前: ${body.customerName || '-'}`,
    `電話: ${body.phone || '-'}`,
  ];

  if (body.lineDisplayName) {
    lines.push(`LINE名: ${body.lineDisplayName}`);
  }

  lines.push('', '※予約リクエストです。内容を確認してお客様へご連絡ください。');
  return lines.join('\n');
}

function buildCustomerMessage(body) {
  return [
    '【予約リクエスト受付】',
    body.storeName || '予約アプリ',
    '',
    `${body.customerName || ''} さま`,
    `${body.menuName || '-'}`,
    `${body.dateLabel || body.date || '-'} ${body.time || ''}`,
    '',
    '内容を確認のうえ、店舗よりご連絡します。',
  ].join('\n');
}

async function pushText(token, userId, text) {
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    }),
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    data = { raw };
  }

  if (!response.ok) {
    const detail = data?.message || raw || `HTTP ${response.status}`;
    const err = new Error(detail);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POSTのみ対応しています' });
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const shopUserId = process.env.SHOP_LINE_USER_ID;
  const notifyCustomer = String(process.env.NOTIFY_CUSTOMER || '').toLowerCase() === 'true';

  if (!token || !shopUserId) {
    return res.status(503).json({
      ok: false,
      code: 'NOTIFY_NOT_CONFIGURED',
      error: '通知設定が未完了です（トークンまたは店舗ユーザーID）',
    });
  }

  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  const phone = String(body.phone || '').replace(/[-\s]/g, '');
  const menuName = String(body.menuName || '').trim();
  const date = String(body.date || '').trim();
  const time = String(body.time || '').trim();

  if (!customerName || !phone || !menuName || !date || !time) {
    return badRequest(res, '予約内容が不足しています');
  }

  if (!/^0\d{9,10}$/.test(phone)) {
    return badRequest(res, '電話番号の形式が正しくありません');
  }

  try {
    await pushText(token, shopUserId, buildShopMessage({ ...body, customerName, phone, menuName }));

    let customerNotified = false;
    if (notifyCustomer && body.lineUserId) {
      try {
        await pushText(token, body.lineUserId, buildCustomerMessage({ ...body, customerName }));
        customerNotified = true;
      } catch (customerErr) {
        console.warn('customer notify failed', customerErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      notified: true,
      customerNotified,
    });
  } catch (err) {
    console.error('shop notify failed', err.message, err.data || '');
    return res.status(502).json({
      ok: false,
      code: 'LINE_PUSH_FAILED',
      error: '店舗への通知送信に失敗しました。公式アカウントの友だち追加や設定を確認してください。',
      detail: err.message,
    });
  }
};
