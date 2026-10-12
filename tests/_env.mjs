process.env.APP_MODE = 'mock';
process.env.STORE ||= 'memory'; // STORE=sqlite npm test runs the scenarios on SQLite
delete process.env.SITE_PASSWORD;
