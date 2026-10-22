# Блочный редактор

## Назначение

Редактировать визуальную программу и показывать эталон одним набором Blockly определений и оформления.

## Границы

Семантика и компиляция принадлежат core. Не создавать второй template/style для palette или reference. Не затирать неисправный, неполный или конфликтующий черновик; не объявлять сохранение до успешного callback.

## Зависимости

window.Blockly, core/visual/language, core/placement/adapter и core/placement/visual. Сеть передаётся callback onProgram.

## Карта

| Путь                                 | Ответственность                                                         |
| ------------------------------------ | ----------------------------------------------------------------------- |
| [block-editor.mjs](block-editor.mjs) | Публичный компонент, события, выделение и трасса                        |
| [workspace.mjs](workspace.mjs)       | Создание, загрузка и размеры редактируемого и reference workspace       |
| [drafts.mjs](drafts.mjs)             | Версии, миграции, восстановление и сохранение локального черновика      |
| [appearance.mjs](appearance.mjs)     | Единственная регистрация определений, theme, toolbox и renderer options |
| [localization.mjs](localization.mjs) | Перевод подписей Blockly без изменения полей, соединений и undo         |
| [appearance.css](appearance.css)     | Единый вид Blockly в palette, editor и reference                        |
| [layout.css](layout.css)             | Размещение рабочего поля и поверхностей Blockly                         |
| [toolbar.css](toolbar.css)           | Действия редактора, вкладки и статус черновика                          |
