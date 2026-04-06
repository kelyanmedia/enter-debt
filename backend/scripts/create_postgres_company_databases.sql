-- Выполнить под суперпользователем PostgreSQL (часто пользователь postgres), затем выдать права своему роли приложения.
-- Замените enterdebt на вашего пользователя БД из DATABASE_URL.

CREATE DATABASE enterdebt_whiteway OWNER enterdebt;
CREATE DATABASE enterdebt_enter_group_media OWNER enterdebt;
