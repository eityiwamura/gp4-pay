-- Remove `annual_multiplier` e `period_label` da tabela `prazos`.
--
-- As duas colunas eram código morto e, pior, sugeriam um comportamento que não existe.
--
-- `annual_multiplier` (365/12/365) foi criada para projetar a economia anual a partir do
-- prazo de recebimento GP4. Mas a projeção não vem daí: vem do período do volume que o
-- vendedor informa ("o cliente vende R$ 100 mil por mês" → x12). São coisas independentes —
-- quanto o cliente fatura por mês não tem relação com a GP4 pagar em D+1 ou D+30. O front
-- sempre usou o botão "Por dia / Por mês", e nunca esta coluna. Mexer nela no banco não
-- mudava cálculo nenhum, o que é uma armadilha para quem for dar manutenção.
--
-- `period_label` ('por dia', 'por mês', 'no mesmo dia') vinha da mesma confusão e só
-- aparecia no texto dos cards de Cadastro de Taxas, onde dava a entender que a taxa era
-- cobrada por dia.
ALTER TABLE prazos DROP COLUMN IF EXISTS annual_multiplier;
ALTER TABLE prazos DROP COLUMN IF EXISTS period_label;
