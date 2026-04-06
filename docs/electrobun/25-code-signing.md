# Code Signing

> Source: https://blackboard.sh/electrobun/docs/guides/code-signing/

## Mac

### Certificate Setup

Apple frequently ships machines with outdated certificates, creating authentication difficulties. Installing the complete Xcode application from the App Store provides a reliable solution. After launching Xcode, navigate to Settings through the app menu, select the Accounts tab, add your developer account, and manage certificates to create a "Developer ID Application" certificate.

### Apple Developer Portal Configuration

In the developer portal, create a new identifier for your application through the Identifiers section. Ensure "App Attest" is enabled to allow Electrobun's CLI to perform code signing and notarization.

### Authentication Setup

Visit https://account.apple.com/sign-in and generate an app-specific password under "App Specific Passwords" for Electrobun's notarization functionality.

### Environment Variables

Add these values to your `.zshrc` file:

```bash
export ELECTROBUN_DEVELOPER_ID="My Corp Inc. (BGU899NB8T)"
export ELECTROBUN_TEAMID="BGU899NB8T"
export ELECTROBUN_APPLEID="[email protected]"
export ELECTROBUN_APPLEIDPASS="your-app-specific-password"
```

Variable sources:
- **ELECTROBUN_DEVELOPER_ID**: Certificate name from Apple Dev Portal
- **ELECTROBUN_TEAMID**: App ID Prefix identifier
- **ELECTROBUN_APPLEID**: Your Apple ID email
- **ELECTROBUN_APPLEIDPASS**: The app-specific password created

### Build Configuration

Update your `electrobun.config` file:

```json
{
    "build": {
        "mac": {
            "codesign": true,
            "notarize": true
        }
    }
}
```

Verify setup by running: `echo $ELECTROBUN_TEAMID`

### App Store Connect API Key (Alternative)

Create an API key through App Store Connect > Users and Access > Integrations > App Store Connect API. Set these environment variables:

```bash
export ELECTROBUN_APPLEAPIKEYPATH="/path/to/AuthKey_XXXXXXXXXX.p8"
export ELECTROBUN_APPLEAPIKEY="XXXXXXXXXX"
export ELECTROBUN_APPLEAPIISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## Unsigned Apps

Unsigned applications trigger macOS security warnings preventing execution. Users can bypass this with:

```bash
xattr -cr /Applications/YourApp.app
```

Production applications should enable code signing and notarization for optimal user experience.
