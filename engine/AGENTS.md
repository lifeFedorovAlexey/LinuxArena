# Нативная арифметика

## Назначение

Сравнивать фиксированный перенос на Rust с адаптированными исходными x86-инструкциями.

## Границы

User-mode harness, не ядро. GNU x86-64 Windows/Linux; QEMU не заявляется. Unsafe только с точным локальным обоснованием.

## Зависимости

Rust 1.99+, без внешних crates. Сервис вызывает известный CLI; build.mjs выбирает поддерживаемый host.

## Карта

| Путь                           | Ответственность                                      |
| ------------------------------ | ---------------------------------------------------- |
| [.gitignore](.gitignore)       | Локальные артефакты Cargo, исключённые из исходников |
| [Cargo.toml](Cargo.toml)       | Crate, targets и строгие Rust/Clippy правила         |
| [Cargo.lock](Cargo.lock)       | Зафиксированный граф Rust-зависимостей               |
| [build.mjs](build.mjs)         | Toolchain, debug/release fmt/check/clippy/test/build |
| [README.md](README.md)         | Назначение, команды и пределы нативной проверки      |
| [src/AGENTS.md](src/AGENTS.md) | Арифметическое ядро и CLI                            |
