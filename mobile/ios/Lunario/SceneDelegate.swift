import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = UIColor(red: 0x0b/255, green: 0x0a/255, blue: 0x14/255, alpha: 1)
        window.rootViewController = ViewController()
        self.window = window
        window.makeKeyAndVisible()
    }
}
