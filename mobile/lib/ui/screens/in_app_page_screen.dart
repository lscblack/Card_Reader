import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../services/domain_allowlist.dart';

/// A page the endpoint asked the phone to open (`action_url`), shown INSIDE nexTap so the person never has
/// to leave the reader and come back. The address was already checked by [isActionUrlAllowed]; this screen
/// keeps it that way: every navigation inside the page must stay https on a host from the application's
/// link domains, anything else is blocked (no other site, no `http`, no custom schemes).
///
/// The page keeps its own sign-in (cookies and local storage persist between taps), so a person signs in
/// once. Back goes back through the page's history, then closes; the close button always closes.
class InAppPageScreen extends StatefulWidget {
  const InAppPageScreen({super.key, required this.url, required this.linkDomains});

  final Uri url;
  final List<String> linkDomains;

  @override
  State<InAppPageScreen> createState() => _InAppPageScreenState();
}

class _InAppPageScreenState extends State<InAppPageScreen> {
  late final WebViewController _controller;
  int _progress = 0;
  bool _blocked = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
        onNavigationRequest: (request) {
          final target = Uri.tryParse(request.url);
          final ok = target != null &&
              target.scheme == 'https' &&
              target.userInfo.isEmpty &&
              isHostAllowed(target.host, widget.linkDomains);
          if (!ok && mounted) setState(() => _blocked = true);
          return ok ? NavigationDecision.navigate : NavigationDecision.prevent;
        },
      ))
      ..loadRequest(widget.url);
  }

  Future<void> _back() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
    } else if (mounted) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const Icon(Icons.close),
            tooltip: 'Close',
            onPressed: () => Navigator.of(context).pop(),
          ),
          title: Text(widget.url.host, style: const TextStyle(fontSize: 16)),
          actions: [
            IconButton(icon: const Icon(Icons.refresh), tooltip: 'Reload', onPressed: () => _controller.reload()),
          ],
          bottom: _progress < 100
              ? PreferredSize(
                  preferredSize: const Size.fromHeight(3),
                  child: LinearProgressIndicator(value: _progress == 0 ? null : _progress / 100, minHeight: 3),
                )
              : null,
        ),
        body: Column(
          children: [
            if (_blocked)
              MaterialBanner(
                content: const Text('A link to another site was blocked.'),
                actions: [TextButton(onPressed: () => setState(() => _blocked = false), child: const Text('OK'))],
              ),
            Expanded(child: WebViewWidget(controller: _controller)),
          ],
        ),
      ),
    );
  }
}
