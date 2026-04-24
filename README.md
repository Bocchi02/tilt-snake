# Tilt Snake

## How to run

1. Open `index.html` in a browser.
2. For real motion controls, serve the folder from `localhost` or HTTPS.
3. Tap **Start Game**, allow motion access if your phone asks, then tilt to steer.

## Motion sensor note

Mobile motion APIs usually work only on secure origins such as `https://` or `http://localhost`. On iPhone and iPad, Safari also requires a user gesture before asking for motion permission.

## Mobile testing checklist

- Open the game on a real phone over HTTPS or localhost.
- Tap **Start Game** and confirm the motion permission prompt appears on iOS.
- Hold the device upright and centered before moving.
- Tilt left, right, forward, and backward to confirm each direction maps correctly.
- Verify that tiny hand jitter does not trigger immediate turns.
- Confirm the snake cannot reverse directly into itself.
- Eat food and check score, growth, sound, and particle burst.
- Crash into a wall or your own body and confirm the game-over screen appears.
- Refresh the page and confirm the high score persists.
- On desktop, verify arrow keys or WASD work as fallback controls.
