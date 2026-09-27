import Contacts
import ContactsUI
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var vcards: VcardChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "NexTapVcard") {
      vcards = VcardChannel(messenger: registrar.messenger())
    }
  }
}

/// iOS side of `net.nexventures.nfc_terminal/contacts` (MainActivity on Android): hands a vCard to the
/// system "Add to Contacts" screen or the share sheet. Everything else Android does natively (NFC, tag
/// dispatch, HCE, dialer, settings) is done in Dart on iOS or doesn't exist there.
final class VcardChannel {
  private let channel: FlutterMethodChannel

  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: "net.nexventures.nfc_terminal/contacts", binaryMessenger: messenger)
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call, result: result)
    }
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any]
    guard let vcard = args?["vcard"] as? String else {
      result(FlutterError(code: "bad_args", message: "vcard missing", details: nil))
      return
    }
    guard let top = VcardChannel.topViewController() else {
      result(false)
      return
    }
    switch call.method {
    case "saveVcard":
      result(VcardChannel.presentAddContact(vcard, from: top))
    case "shareVcard":
      result(VcardChannel.presentShare(vcard, name: args?["name"] as? String ?? "contact", from: top))
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  /// The system contact card with "Create New Contact" / "Add to Existing Contact" (no Contacts permission needed).
  private static func presentAddContact(_ vcard: String, from top: UIViewController) -> Bool {
    guard let data = vcard.data(using: .utf8),
          let contact = (try? CNContactVCardSerialization.contacts(with: data))?.first else { return false }
    let card = CNContactViewController(forUnknownContact: contact)
    card.contactStore = CNContactStore()
    card.allowsActions = false
    let nav = UINavigationController(rootViewController: card)
    card.navigationItem.leftBarButtonItem = UIBarButtonItem(
      systemItem: .close,
      primaryAction: UIAction { [weak nav] _ in nav?.dismiss(animated: true) }
    )
    top.present(nav, animated: true)
    return true
  }

  private static func presentShare(_ vcard: String, name: String, from top: UIViewController) -> Bool {
    let safe = String(name.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression).prefix(40))
    do {
      let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shared", isDirectory: true)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let file = dir.appendingPathComponent("\(safe.isEmpty ? "contact" : safe).vcf")
      try vcard.write(to: file, atomically: true, encoding: .utf8)
      let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
      // iPad: the share sheet is a popover and needs an anchor.
      sheet.popoverPresentationController?.sourceView = top.view
      sheet.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
      top.present(sheet, animated: true)
      return true
    } catch {
      return false
    }
  }

  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.flatMap { $0.windows }
    var top = (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}
