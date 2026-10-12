const { query, run } = require('../models/database');

exports.processEarnings = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date().toISOString();
    const active = await query(
      "SELECT i.*, p.name as plan_name, p.deposit_returned FROM investments i JOIN plans p ON i.plan_id=p.id WHERE i.status='active'"
    );

    let credited = 0;
    let completed = 0;

    for (const inv of active) {
      const userId      = Number(inv.user_id);
      const invId       = Number(inv.id);
      const amount      = Number(inv.amount);
      const dailyPct    = Number(inv.daily_percent);
      const depReturned = Number(inv.deposit_returned);
      const dailyEarn   = amount * dailyPct / 100;

      await run('UPDATE users SET balance = balance + ? WHERE id = ?', [dailyEarn, userId]);
      await run('UPDATE investments SET earned = earned + ? WHERE id = ?', [dailyEarn, invId]);
      await run(
        "INSERT INTO transactions (user_id,type,amount,status,note) VALUES (?,'earning',?,'completed',?)",
        [userId, dailyEarn, `Daily return — ${inv.plan_name}`]
      );
      credited++;

      if (now >= inv.end_date) {
        if (depReturned) {
          await run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
          await run(
            "INSERT INTO transactions (user_id,type,amount,status,note) VALUES (?,'earning',?,'completed',?)",
            [userId, amount, `Principal returned — ${inv.plan_name}`]
          );
        }
        await run("UPDATE investments SET status='completed' WHERE id=?", [invId]);
        completed++;
      }
    }

    res.json({ ok: true, processed: active.length, credited, completed, ts: now });
  } catch (err) {
    console.error('[cron/earnings]', err);
    res.status(500).json({ error: err.message });
  }
};
