// Initializes application DB user for Reblock.
// Runs only on first container bootstrap when /data/db is empty.

const appDb = process.env.MONGO_APP_DB;
const appUser = process.env.MONGO_APP_USER;
const appPassword = process.env.MONGO_APP_PASSWORD;

if (!appDb || !appUser || !appPassword) {
  throw new Error('Missing MONGO_APP_DB/MONGO_APP_USER/MONGO_APP_PASSWORD for Mongo init');
}

const dbRef = db.getSiblingDB(appDb);
const existing = dbRef.getUser(appUser);

if (existing) {
  print(`[mongo-init] user ${appUser} already exists in ${appDb}, skip`);
} else {
  dbRef.createUser({
    user: appUser,
    pwd: appPassword,
    roles: [
      {
        role: 'readWrite',
        db: appDb,
      },
    ],
  });
  print(`[mongo-init] created app user ${appUser} for db ${appDb}`);
}
