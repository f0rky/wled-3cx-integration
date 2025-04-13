# 3CX/Slack Status Light (v2.0.0)

This project integrates 3CX phone system status and (future) Slack status with WLED LED strips. It monitors your 3CX status (Available, Ringing, On Call, etc.) and updates the WLED color accordingly. It also provides a comprehensive team dashboard for status monitoring and basic control.

## Features

- Automatically updates WLED color based on your 3CX phone status.
- Uses Puppeteer to scrape the 3CX web client for status information.
- Persists 3CX login session using cookies to minimize manual logins.
- Configurable colors for different 3CX statuses.
- Advanced team dashboard with filtering and organization features:
  - Groups team members by queue membership and availability
  - Sorts team members by number of queues (most to least)
  - Option to show/hide offline team members
  - Real-time status updates via WebSockets
- Optimized screenshot generation with configurable limits to prevent storage issues
- Improved WLED status checking to reduce network traffic and server load
- Enhanced WebSocket connection handling for better reliability
- Structured logging using Pino
- Code linting and formatting using ESLint and Prettier
- Graceful shutdown with LED reset
- Configuration via `.env` file

## Architecture Overview

- **Backend Server (`src/app.js`):** An Express.js server that:
  - Serves the static web dashboard files (HTML, CSS, JS).
  - Provides API endpoints for configuration and status.
  - Manages WebSocket connections for real-time updates to the dashboard.
  - Coordinates the 3CX client and WLED controller.
- **3CX Web Client (`src/threecx-web-client-fixed.js`):**
  - Uses Puppeteer to launch a browser instance (headless or visible).
  - Logs into the 3CX web client UI (requires manual login on first run, saves cookies thereafter).
  - Periodically scrapes the UI to determine the user's current phone status and call statistics.
  - Reports status changes back to the main application.
- **WLED Controller (`src/wled-controller.js`):**
  - Communicates with the WLED device via its HTTP JSON API.
  - Sends commands to set the color, brightness, and effects based on the 3CX status.
- **Web Dashboard (`public/`):**
  - A simple HTML/CSS/JavaScript frontend.
  - Connects to the backend via WebSockets to display real-time status.
  - Allows viewing configuration and potentially manual overrides (future enhancement).
- **Configuration (`.env`):** Stores settings like WLED IP, 3CX URL, colors, etc.
- **Logging (`pino`):** Provides structured, configurable logging for monitoring and debugging.

## Prerequisites

- Node.js (v16 or higher recommended)
- npm (comes with Node.js)
- Access to a 3CX account and its web client URL.
- A WLED-controlled LED strip accessible on your network.

## Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/f0rky/wled-3cx-integration.git
    cd wled-3cx-integration
    ```

2.  **(Optional but Recommended) Use Node Version Manager (`nvm`):**
    If you don't have nvm, [install it first](https://github.com/nvm-sh/nvm#installing-and-updating).

    ```bash
    # Install and use a compatible Node.js version (e.g., 16)
    nvm install 16
    nvm use 16
    ```

3.  **Install dependencies:**

    ```bash
    npm install
    ```

4.  **Configure your environment:**
    Copy the example environment file:
    ```bash
    cp .env.example .env
    ```
    Then, **edit the `.env` file** with your specific configuration (see Configuration section below).

## Configuration

Edit the `.env` file to match your setup. Key variables include:

### WLED Configuration

- `WLED_IP_ADDRESS`: **Required.** The IP address of your WLED device.
- `WLED_BRIGHTNESS`: Default brightness level (0-255). Default: `255`.
- `WLED_TRANSITION`: Default transition time in milliseconds. Default: `7`.

### Server Configuration

- `SERVER_PORT`: Port for the web UI. Default: `1550`.

### 3CX Web Client Configuration

- `THREECX_WEB_URL`: **Required.** The full URL of your 3CX web interface (e.g., `https://mycompany.my3cx.com`).
- `THREECX_REFRESH_INTERVAL`: How often (in milliseconds) to check the 3CX status. Default: `5000` (5 seconds).
- `THREECX_HEADLESS`: Run Puppeteer browser in headless mode (`true`) or visible mode (`false`) after the initial login. Default: `true`.

### Logging Configuration

- `LOG_LEVEL`: Set the logging verbosity. Options: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Default: `info`.

### Status Color Mapping

Configure the RGB colors used for each status:

- `COLOR_AVAILABLE`
- `COLOR_RINGING`
- `COLOR_ON_CALL`
- `COLOR_DND` (Do Not Disturb)
- `COLOR_AWAY`
- `COLOR_OFFLINE`
  _(Defaults are provided in `.env.example`)_

**Important Note on 3CX Login:**
The application uses Puppeteer to interact with the 3CX web client UI. On the **first run**, a browser window will likely open, requiring you to **manually log in** to your 3CX account. After successful login, the application saves your session cookies to `cookies.json` (this file should be kept private and is ignored by git). Subsequent runs will use these cookies to log in automatically, usually in headless mode (if configured). If the cookies expire or become invalid, you may need to delete `cookies.json` and log in manually again.

## Usage

To run the application:

```bash
npm start
```

This will start the server, initialize the 3CX connection (potentially prompting for login), and begin monitoring your status.

You can access the web dashboard by navigating to `http://localhost:SERVER_PORT` (replace `SERVER_PORT` with the value from your `.env` file, default is 1550).

## Development

To run the application in development mode with auto-restart on file changes (using `nodemon`):

```bash
npm run dev
```

### Code Formatting and Linting

This project uses Prettier for code formatting and ESLint for code linting.

- **Format Code:** To automatically format all code according to Prettier rules:
  ```bash
  npm run format
  ```
- **Lint Code:** To check for code style issues and potential errors using ESLint:
  ```bash
  npm run lint
  ```
  This command will also attempt to automatically fix fixable issues.

It's recommended to run these commands before committing changes.

## How It Works (Details)

1.  **Initialization:** The `app.js` script starts the Express server, sets up WebSocket communication, and initializes the `wled-controller.js` and `threecx-web-client-fixed.js` modules based on the `.env` configuration.
2.  **3CX Connection:** `threecx-web-client-fixed.js` launches Puppeteer. It attempts to load saved cookies from `cookies.json`. If cookies are invalid or missing, it launches a visible browser for manual login. Once logged in, cookies are saved.
3.  **Status Polling:** The 3CX client periodically scrapes the web UI (e.g., looking for specific CSS classes or text associated with status indicators) at the interval defined by `THREECX_REFRESH_INTERVAL`.
4.  **Status Update:** When a status change is detected by the 3CX client, it notifies `app.js`.
5.  **WLED Update:** `app.js` determines the appropriate color from the `.env` configuration based on the new status and instructs `wled-controller.js` to send the corresponding command (e.g., setting color, brightness) to the WLED device's HTTP API.
6.  **WebSocket Broadcast:** `app.js` broadcasts the new status information to all connected web dashboard clients via WebSockets.
7.  **Dashboard Update:** The web dashboard (`public/script.js`) receives the WebSocket message and updates the displayed status.

## Status Color Mapping (Defaults)

- Available: Green (RGB: 0, 255, 0)
- Ringing: Yellow (RGB: 255, 255, 0)
- On Call: Red (RGB: 255, 0, 0)
- Do Not Disturb: Purple (RGB: 128, 0, 128)
- Away: Orange (RGB: 255, 165, 0)
- Offline: Blue (RGB: 0, 0, 255)

These can be customized in the `.env` file.

## Troubleshooting

- **Login Issues:** If the application fails to log in or gets stuck, try deleting the `cookies.json` file and running `npm start` again. This will force a manual login.
- **Incorrect Status:** 3CX UI changes can break the scraping logic. Check the selectors in `src/threecx-web-client-fixed.js` (functions like `getStatus`, `fetchCallStats`) if the status is consistently wrong. Enable `debug` logging (`LOG_LEVEL=debug` in `.env`) for more detailed output from Puppeteer.
- **WLED Not Responding:** Ensure the `WLED_IP_ADDRESS` in `.env` is correct and the WLED device is online and accessible from the machine running the script.
- **Team Dashboard Issues:** If team members are not appearing in the correct columns, check the queue detection logic in the scraping module.

## Future Enhancements

### Slack Integration

A planned future enhancement is to integrate with Slack's API to retrieve user status information:

- Fetch Slack status for team members not available in 3CX
- Combine 3CX and Slack status data for a comprehensive view
- Update WLED colors based on combined status priority
- Display Slack status emoji and custom status messages on the dashboard
- Support for Slack status sync across team members

This will provide a more complete picture of team availability across both communication platforms.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. Ensure your code passes linting (`npm run lint`) and formatting (`npm run format`) checks.
