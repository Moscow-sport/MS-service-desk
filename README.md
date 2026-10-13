# MS service desk: deployment notes

## Google Apps Script deployment
1. Откройте проект Apps Script и добавьте/обновите файл `Code.gs`.
2. В **Project Settings → Script properties** задайте значения:
   - `SPREADSHEET_ID`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `ADMIN_EMAILS` (через запятую)
3. Выполните **Deploy → Manage deployments → Edit → New version → Deploy**.
4. Если бот уже был опубликован ранее, заново обновите webhook на новый URL веб-приложения с текущим bot token.

> Не храните токены, chat id, spreadsheet id и другие секреты в исходниках.

## Что изменено в этом наборе правок
- `checkStatus` и `addFeedback` поддерживают ссылку на заявку как по номеру строки, так и по `Request ID`.
- Добавлено безопасное разрешение ссылки на заявку с понятными ошибками (`request not found`, отсутствие колонки `Request ID` и т.п.).
- Callback `set` в Telegram обрабатывается быстрее: мгновенный `answerCallbackQuery`, минимальные чтения, одно сохранение значения и одно обновление сообщения.
- `success.js` отправляет `requestId`, корректно обрабатывает `request not found`, не запускает параллельный polling и показывает форму обратной связи для `Выполнено`/`Отказано`.

## Минимальные ручные проверки в Apps Script
1. Отправьте заявку из `index.html`, убедитесь что в листе сохраняется `Request ID`.
2. Выполните POST `checkStatus` с `requestId` и с `row` — оба варианта должны работать.
3. Выполните POST `addFeedback` с `requestId` и с `row`.
4. В Telegram нажмите inline-кнопку `set` и проверьте:
   - нет долгого "часика" в клиенте;
   - значение сохранено в таблицу;
   - в сообщении корректно обновлён selected state.
5. Убедитесь, что остальные сценарии (меню, админы, отчёты, webhook) работают в вашем основном GAS-проекте.
