async function dismissWelcome(page) {
  await page.locator('.app-shell').waitFor();
  if (await page.getByRole('dialog', { name: '选择你的工作区', exact: true }).count()) {
    await page.getByRole('button', { name: '跳过，使用经典工作台', exact: true }).click();
  }
}
module.exports = { dismissWelcome };
