# Проверки слияния

## Назначение

Повторять локальные требования в CI и задавать защищённое слияние.

## Границы

JSON не заменяет реальную branch protection. Не считать локальный PASS выполненным GitHub CI.

## Зависимости

GitHub Actions вызывает npm run quality; main требует оба OS job даже для администратора.

## Карта

| Путь                                                 | Ответственность                                   |
| ---------------------------------------------------- | ------------------------------------------------- |
| [branch-protection.json](branch-protection.json)     | Требуемые статусы и запрет force-push/delete      |
| [CODEOWNERS](CODEOWNERS)                             | Маршрутизация ревью владельцу проекта             |
| [pull_request_template.md](pull_request_template.md) | Контракты, доказательства и ограничения изменения |
| [workflows/AGENTS.md](workflows/AGENTS.md)           | Матрица сборки и проверки                         |
