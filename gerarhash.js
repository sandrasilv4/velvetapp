const bcrypt = require("bcrypt");

async function gerar() {
  const hash = await bcrypt.hash("260492", 10);
  console.log(hash);
}

gerar();
