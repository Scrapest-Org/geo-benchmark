# Web Push Service

This service allows you to track Twitter/X users and receive their updates via push notifications, which are then forwarded to registered verification webhooks. It manages the connection to an "Autopush" service (like Mozilla's) and handles Twitter authentication and notifications.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime
- Redis (for storing webhooks)

### Installation

```bash
bun install
```

### Running the Service

Development mode (with hot reload):

```bash
bun run dev
```

Production mode:

```bash
bun run start
```

The server listens on port `6969` by default (or user defined `PORT` env var).

---

## API Endpoints

### General

#### Health Check

Check if the service is running.

- **URL**: `/`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "message": "Web Push Service is running"
  }
  ```

---

### Webhooks

Manage the URLs that will receive forwarded tweet notifications.

#### Register Webhook

Add a new webhook URL to the list.

- **URL**: `/webhook`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "url": "https://your-webhook.com/endpoint"
  }
  ```
- **Response**:
  ```json
  {
    "message": "Webhook registered successfully"
  }
  ```

#### List Webhooks

Retrieve all registered webhook URLs.

- **URL**: `/webhooks`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "webhooks": ["https://your-webhook.com/endpoint"]
  }
  ```

#### Delete Webhook

Remove a webhook URL from the list.

- **URL**: `/webhook`
- **Method**: `DELETE`
- **Body**:
  ```json
  {
    "url": "https://your-webhook.com/endpoint"
  }
  ```
- **Response**:
  ```json
  {
    "message": "Webhook deleted successfully"
  }
  ```

---

### User Tracking

Manage which Twitter/X users are being tracked.

#### Track User

Start tracking a specific user. This will follow the user and turn on notifications for their tweets.

- **URL**: `/track-user`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "username": "twitter_handle"
  }
  ```
- **Response**:
  ```json
  {
    "message": "Now tracking <Name>",
    "data": { ...user_data }
  }
  ```

#### Untrack User

Stop tracking a user. This will unfollow the user and turn off notifications.

- **URL**: `/track-user`
- **Method**: `DELETE`
- **Body**:
  ```json
  {
    "username": "twitter_handle"
  }
  ```
- **Response**:
  ```json
  {
    "message": "Stopped tracking user twitter_handle"
  }
  ```

#### List Tracked Users

_Note: This endpoint currently returns an empty list as implementation is pending._

- **URL**: `/tracked-users`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "tracked_users": []
  }
  ```
