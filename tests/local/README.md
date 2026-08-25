# Extratos reais para conferencia local

Esta pasta e ignorada pelo git (veja `.gitignore`).

Extrato de verdade contem CNPJ, nome e valor de clientes e fornecedores reais,
alem do numero da conta. Isso nao entra em repositorio — nem privado, porque
quem ganha acesso ao codigo passaria a ter a carteira de clientes junto.

Para conferir um leitor contra um extrato de verdade, coloque o arquivo aqui e
rode:

```bash
npx vitest run tests/local
```

Quando nao ha arquivo, os testes desta pasta se declaram pulados em vez de
falhar, para nao quebrar o CI.

As fixtures versionadas, em `tests/fixtures`, sao anonimizadas: preservam a
estrutura exata do extrato — colunas, recuos, nomes truncados, ordem invertida —
com nomes, documentos e valores trocados.
