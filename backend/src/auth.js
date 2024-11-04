const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const bcrypt = require("bcrypt");
const pool = require("./db");
const { generateRandom8DigitNumber } = require("./helpers/utils");

passport.use(
  new LocalStrategy(async (username, password, done) => {
    console.log("username, password", username, password);
    try {
      const res = await pool.query("SELECT * FROM users WHERE username = $1", [
        username,
      ]);
      const user = res.rows[0];
      console.log("user", user);
      if (!user) {
        return done(null, false, { message: "Incorrect username." });
      }
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return done(null, false, { message: "Incorrect password." });
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// Google Strategy for Google OAuth Authentication
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },

    async (accessToken, refreshToken, profile, done) => {
      try {
        const res = await pool.query(
          "SELECT * FROM users WHERE google_id = $1",
          [profile.id]
        );
        let user = res.rows[0];
        console.log("user!!!", user);
        if (!user) {
          // If the user does not exist, create a new one
          const randomNumber = generateRandom8DigitNumber();
          const newUserAttributes = {
            id: randomNumber,
            attributes_id: randomNumber,
            created_at: new Date().toISOString(),
            current_room_id: "+0000+0000+0000+0001",
            email: profile.emails[0].value,
            inventory_id: randomNumber,
            long_description_id: randomNumber,
            name: "spirit",
            password_hash: "",
            role: "new player",
            short_description_id: randomNumber,
            username: profile.displayName,
            google_id: profile.id,
          };
          const {
            id,
            attributes_id,
            created_at,
            current_room_id,
            email,
            inventory_id,
            long_description_id,
            name,
            password_hash,
            role,
            short_description_id,
            username,
            google_id,
          } = newUserAttributes;
          // Insert all fields into the users table
          const newUserRes = await pool.query(
            `INSERT INTO users (
                id,
                attributes_id,
                created_at,
                current_room_id,
                email,
                inventory_id,
                long_description_id,
                name,
                password_hash,
                role,
                short_description_id,
                username,
                google_id
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
            [
              id,
              attributes_id,
              created_at,
              current_room_id,
              email,
              inventory_id,
              long_description_id,
              name,
              password_hash,
              role,
              short_description_id,
              username,
              google_id,
            ]
          );
          console.log("New user created:", newUserRes.rows[0]);
          user = newUserRes.rows[0];
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const res = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    const user = res.rows[0];
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
