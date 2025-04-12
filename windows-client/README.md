# 3CX Status Client for Windows

This Windows client monitors your 3CX phone status and automatically updates your WLED device to reflect your current call status.

## How It Works

The client runs on your Windows PC where the 3CX client is installed. It:

1. Monitors the 3CX client process on your Windows PC
2. Detects status changes (on call, available, etc.)
3. Sends updates to your WLED device over your network

## Setup Instructions

### Prerequisites

- Windows PC with 3CX client installed
- Node.js installed on the Windows PC
- WLED device configured on your network

### Installation

1. Clone this repository on your Windows PC:
   ```
   git clone https://github.com/f0rky/wled-3cx-integration.git
   cd wled-3cx-integration/windows-client
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with your WLED configuration:
   ```
   WLED_IP_ADDRESS=192.168.111.50
   WLED_BRIGHTNESS=128
   WLED_TRANSITION=1000
   ```

### Running the Client

```
node 3cx-status-client.js
```

For convenience, you can create a shortcut to run this at Windows startup.

## Status Color Mapping

- Available: Green (RGB: 0, 255, 0)
- Ringing: Yellow (RGB: 255, 255, 0)
- On Call: Red (RGB: 255, 0, 0)
- Do Not Disturb: Purple (RGB: 128, 0, 128)
- Away: Orange (RGB: 255, 165, 0)
- Offline: Blue (RGB: 0, 0, 255)

## Customization

You can customize the colors and behavior by editing the configuration in the `3cx-status-client.js` file.
