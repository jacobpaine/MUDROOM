const express = require('express');
const passport = require('../auth'); // Adjust the path to your auth file if necessary
const router = express.Router();

// router.post('/login', (req, res, next) => {
//   passport.authenticate('local', (err, user, info) => {
//     if (err) {
//       return res.status(500).json({ message: 'An error occurred during authentication', error: err });
//     }
//     if (!user) {
//       return res.status(401).json({ message: 'Authentication failed', info });
//     }
//     req.login(user, (loginErr) => {
//       if (loginErr) {
//         return res.status(500).json({ message: 'Login failed', error: loginErr });
//       }
//       return res.json({ message: 'Login successful', user });
//     });
//   })(req, res, next);
// });

router.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login',
  failureFlash: true // Enable flash messages for errors
}));
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/');
  }
);

router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Error during logout:', err);
      return res.status(500).send('Error logging out');
    }
    res.redirect('/login'); // Redirect to the login page after logging out
  });
});


module.exports = router;
