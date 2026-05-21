-- Fix: remove circular parent reference from account 1100
UPDATE gl_account SET parent_id = NULL WHERE account_code = '1100';
