# WLED-3CX Integration

This application integrates a 3CX phone system with WLED-controlled LED strips to visually display call status through different colors.

## Features

- Real-time status updates via WebSocket connection to 3CX
- Fallback polling mechanism if WebSocket is unavailable
- Configurable colors for different phone statuses:
  - Available: Green
  - Ringing: Yellow
  - On Call: Red
  - Do Not Disturb: Purple
  - Away: Orange
  - Offline: Blue
- Graceful shutdown with LED reset
- Environment-based configuration

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- 3CX phone system with WebSocket API access
- WLED-controlled LED strip (accessible via HTTP API)

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/wled-3cx-integration.git
   cd wled-3cx-integration
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure your environment:
   ```
   cp .env.example .env
   ```
   Then edit the `.env` file with your specific configuration.

## Configuration

Edit the `.env` file with your specific settings:

```
# 3CX Configuration
THREECX_WEBSOCKET_URL=ws://your-3cx-server:port
THREECX_USERNAME=your-username
THREECX_PASSWORD=your-password
THREECX_EXTENSION=your-extension

# WLED Configuration
WLED_IP_ADDRESS=192.168.1.100
WLED_BRIGHTNESS=128
WLED_TRANSITION=1000

# Polling interval (ms) if WebSocket is not available
POLLING_INTERVAL=5000
```

## Usage

Start the application:

```
npm start
```

For development with auto-restart on file changes:

```
npm run dev
```

## How It Works

1. The application connects to the 3CX WebSocket API to receive real-time status updates.
2. When a status change is detected, it maps the status to a corresponding color.
3. The WLED device is updated with the new color via its HTTP API.
4. If the WebSocket connection fails, the application falls back to polling the 3CX API at regular intervals.

## Status Color Mapping

- Available: Green (RGB: 0, 255, 0)
- Ringing: Yellow (RGB: 255, 255, 0)
- On Call: Red (RGB: 255, 0, 0)
- Do Not Disturb: Purple (RGB: 128, 0, 128)
- Away: Orange (RGB: 255, 165, 0)
- Offline: Blue (RGB: 0, 0, 255)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
