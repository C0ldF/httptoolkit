# HTTP Toolkit Pro Patcher

This is a simple tool to patch the HTTP Toolkit Pro app to enable the Pro features without a license or subscription. **But please consider supporting the developer by purchasing a license if you find the HTTP Toolkit useful.**

## About

This project is a fork of [C0ldF/httptoolkit](https://github.com/C0ldF/httptoolkit), updated to work with the latest version of the HTTP Toolkit app. Notable fixes in this fork:

- Works with the current HTTP Toolkit desktop app (tested on v1.20.1)
- Fixed `https-proxy-agent` loading so the app starts even without a proxy configured
- Fixed compatibility with Express 5 (`path-to-regexp` v8 no longer accepts `*` wildcards)
- Injected a full `UserData`-compatible object so the UI no longer crashes on startup
- The patcher now kills stale HTTP Toolkit processes holding the management/proxy ports before starting (Windows and Linux/macOS)
- Subscriptions are set to effectively never expire

## Usage

1. Clone this repository using `git clone https://github.com/cointhedev/httptoolkit.git`
2. cd into the directory using `cd httptoolkit`
3. Run `npm install` or whatever package manager you use
4. Run `node . patch` to patch the app

That's it! The app should now have the Pro features enabled.

***Tip**: You can also run `node . restore` to restore the original app.*

**Note**: This tool only works with the latest version of the app. If the app is updated, you will need to run the patcher again.

## Using with Proxy

If you want to add a proxy to the patcher, you can set the `PROXY` environment variable. For example, `PROXY=http://x.x.x.x:8080 node . patch` or `PROXY=http://x.x.x.x:8080 node . start`.

**Note**: The proxy must be an HTTPS/HTTP proxy. SOCKS proxies are not supported.
**Note**: `PROXY` is only used for the patcher. The app itself will not use the proxy.

## How it works

This tool simply creates a server *(at port 5067)* and acts as like a MITM proxy to intercept and download HTTP Toolkit app files ([app.httptoolkit.tech](https://app.httptoolkit.tech)) and patches the `main.js` file to enable the Pro features. For more information, see the [patch's source code](patch.js) or the [patcher](index.js) file.

***Tip**: You can also change the `PORT` environment variable to use a different port. For example, `PORT=8080 httptoolkit` or `PORT=8080 node . start`.*

**Note**: This tool does not modify the original app files. It only intercepts and modifies the files in memory (and saves the modified files to cache).

## Requirements

- [Node.js](https://nodejs.org) (v15 or higher) (with npm 7 at least)

## Compatibility

- **Windows**: ✔
- **Linux**: ✔
- **macOS**: ✔

## Known Issues

- **Linux**: Try using `sudo` if you get permission errors
- If you get an error like `No internet connection and file is not cached`, it means the patcher is unable to connect to the internet. Make sure you have an active internet connection and try again. If you are using a proxy, make sure proxy is working well.
- If HTTP Toolkit does not start after patching, try updating your Node.js version to the latest version.
- **macOS**: You may need to enable "App Management" for your terminal emulator in Privacy & Security if you get permission errors.

## Screenshot

![Screenshot](https://i.imgur.com/keYK7zR.png)

## License

This project is licensed under the [MIT License](LICENSE).

## Disclaimer

This project is for educational purposes only. I do not condone piracy or any illegal activities. Use at your own risk.

## Credits

- [HTTP Toolkit](https://httptoolkit.com) for the awesome app
- [Titoot](https://github.com/Titoot) for the creating the [httptoolkit-interceptor](https://github.com/Titoot/httptoolkit-interceptor)
- [XielQ](https://github.com/XielQs) for the creator of this patcher
