// Pages ring through CallKit even when the app is closed. iOS hands a VoIP push to AppDelegate and
// ends the app unless it reports a call to CallKit straight away, before any JavaScript runs. So
// AppDelegate becomes the PushKit delegate: it reports the call natively, then passes the payload to
// JavaScript (src/calls/ios.ts) to watch, answer or end it.
const fs = require('node:fs');
const path = require('node:path');
const { withAppDelegate, withDangerousMod } = require('expo/config-plugins');

const METHODS = `
  // PushKit: every VoIP push is a page call (D1). Report it to CallKit first, then hand it to JS.
  func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    RNVoipPushNotificationManager.didUpdate(credentials, forType: type.rawValue)
  }

  func pushRegistry(
    _ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let data = payload.dictionaryPayload
    let callId = (data["callId"] as? String) ?? UUID().uuidString.lowercased()
    let incident = (data["incidentId"] as? String) ?? (data["incidentId"] as? NSNumber)?.stringValue ?? ""
    let title = (data["title"] as? String) ?? "PagerDiem"
    RNCallKeep.reportNewIncomingCall(
      callId, handle: "Incident #\\(incident)", handleType: "generic", hasVideo: false, localizedCallerName: title,
      supportsHolding: false, supportsDTMF: false, supportsGrouping: false, supportsUngrouping: false,
      fromPushKit: true, payload: data, withCompletionHandler: nil)
    RNVoipPushNotificationManager.addCompletionHandler(callId, completionHandler: completion)
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)
  }
`;

const LAUNCH = 'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';

function withPushKitAppDelegate(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') throw new Error('with-voip-callkit expects a Swift AppDelegate');
    let src = mod.modResults.contents;
    if (src.includes('PKPushRegistryDelegate')) return mod; // already applied
    const edit = (find, replace) => {
      if (!src.includes(find)) throw new Error(`with-voip-callkit: AppDelegate.swift no longer contains "${find}"`);
      src = src.replace(find, replace);
    };
    edit('import React\n', 'import React\nimport PushKit\n');
    edit('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider, PKPushRegistryDelegate {');
    // The registry has to exist at launch so iOS can deliver a push to a closed app.
    edit(`    ${LAUNCH}\n  }\n`, `    RNVoipPushNotificationManager.voipRegistration()\n    ${LAUNCH}\n  }\n${METHODS}`);
    mod.modResults.contents = src;
    return mod;
  });
}

function withBridgingHeader(config) {
  return withDangerousMod(config, ['ios', async (mod) => {
    const dir = path.join(mod.modRequest.platformProjectRoot, mod.modRequest.projectName);
    const file = path.join(dir, `${mod.modRequest.projectName}-Bridging-Header.h`);
    const imports = ['#import <RNCallKeep/RNCallKeep.h>', '#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>'];
    const current = fs.readFileSync(file, 'utf8');
    const missing = imports.filter((line) => !current.includes(line));
    if (missing.length) fs.writeFileSync(file, `${current.trimEnd()}\n${missing.join('\n')}\n`);
    return mod;
  }]);
}

module.exports = (config) => withBridgingHeader(withPushKitAppDelegate(config));
