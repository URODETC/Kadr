import { createUser, db, hashPassword, username } from "../lib/server/auth.mjs";
import { createInterface } from "node:readline/promises";
// Password enters through stdin, never through process arguments or a default password.
const mode = process.argv[2],
  name = process.argv[3];
if (!["create", "reset"].includes(mode) || !name) {
  console.error(
    "Usage: npm run admin -- create|reset USERNAME (password via stdin)",
  );
  process.exit(1);
}
let password = "";
if (process.stdin.isTTY) {
  process.stdout.write("Пароль (12–128 символов): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  password = await new Promise((resolve) => {
    process.stdin.on("data", function input(chunk) {
      for (const c of chunk) {
        if (c === "\u0003") process.exit(130);
        if (c === "\r" || c === "\n") {
          process.stdin.off("data", input);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(password);
          return;
        }
        if (c === "\u007f") password = password.slice(0, -1);
        else if (c >= " ") password += c;
      }
    });
  });
} else {
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    password = line;
    break;
  }
  input.close();
}
try {
  if (mode === "create") {
    if (db().prepare("SELECT id FROM users WHERE role='admin'").get())
      throw new Error(
        "Суперадминистратор уже создан. Для восстановления используйте reset.",
      );
    await createUser(name, password, "admin");
  } else {
    const user = db()
      .prepare("SELECT id FROM users WHERE username=? AND role='admin'")
      .get(username(name));
    if (!user) throw new Error("Суперадминистратор не найден.");
    db()
      .prepare("UPDATE users SET password=? WHERE id=?")
      .run(await hashPassword(password), user.id);
    db().prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
  }
  console.log("Готово.");
} catch (e) {
  console.error(e.message.includes("UNIQUE") ? "Логин уже занят." : e.message);
  process.exitCode = 1;
}
