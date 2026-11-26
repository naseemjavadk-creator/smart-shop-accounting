-- Chart of accounts and default settings (no financial data)
insert into accounts (code, name, type, system_key, is_expense_category) values
 ('1000','Cash in hand','asset','cash',false),
 ('1010','Bank','asset','bank',false),
 ('1100','Accounts receivable (customers)','asset','ar',false),
 ('1200','Inventory','asset','inventory',false),
 ('1300','VAT input (recoverable)','asset','vat_input',false),
 ('2000','Accounts payable (suppliers)','liability','ap',false),
 ('2100','VAT output (payable)','liability','vat_output',false),
 ('3000','Owner''s capital','equity','capital',false),
 ('3100','Owner''s drawings','equity','drawings',false),
 ('3200','Opening balance equity','equity','opening_equity',false),
 ('3300','Retained earnings','equity','retained_earnings',false),
 ('4000','Sales - goods','income','sales_goods',false),
 ('4010','Sales - services','income','sales_services',false),
 ('4100','Sales returns','income','sales_returns',false),
 ('4900','Other income','income','other_income',false),
 ('5000','Cost of goods sold','expense','cogs',false),
 ('5010','Stock loss / damage / adjustments','expense','stock_adjustment',false),
 ('5020','Purchases - non-stock items','expense','nonstock_purchases',false),
 ('6000','Shop rent','expense',null,true),
 ('6010','Electricity','expense',null,true),
 ('6020','Water','expense',null,true),
 ('6030','Internet & phone','expense',null,true),
 ('6040','Employee salaries','expense',null,true),
 ('6050','Transportation','expense',null,true),
 ('6060','Maintenance & repairs','expense',null,true),
 ('6070','Packaging','expense',null,true),
 ('6080','Bank charges','expense',null,true),
 ('6090','Licences & government fees','expense',null,true),
 ('6100','Food & refreshments','expense',null,true),
 ('6900','Other expenses','expense','other_expense',true);

insert into categories (name) values
 ('Stationery'),('Books'),('Printing & photocopy'),('Digital services'),
 ('Vegetables'),('Groceries'),('Mobile accessories'),('Other');

insert into settings (key, value) values
 ('shop', '{"name":"My Shop","trn":"","address":"","phone":""}'),
 ('vat', '{"registered":true,"standard_rate":5,"sales_prices_include_vat":true,"purchase_prices_include_vat":false}'),
 ('currency', '"AED"'),
 ('timezone', '"Asia/Dubai"'),
 ('ai', '{"monthly_budget_usd":10}'),
 ('sheets', '{"spreadsheet_id":"","enabled":false}');
