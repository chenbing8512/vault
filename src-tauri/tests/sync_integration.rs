//! 集成测试：真实连接服务器，测 login/push/pull/conflict。不碰用户数据。
use vault::sync;

fn server() -> String { "https://vault-sync.43.153.51.6.sslip.io/vault-sync".into() }

#[test]
fn full_roundtrip() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let u = format!("t_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() % 100000);
        // 注册
        let acct = sync::login(server(), u.clone(), "Test12345678".into(), true).await.expect("register");
        assert!(!acct.token.is_empty());
        // 重复注册应失败
        assert!(sync::login(server(), u.clone(), "Test12345678".into(), true).await.is_err());
        // 版本应为空
        let v = sync::version(acct.clone()).await.expect("version");
        assert!(!v.exists); assert_eq!(v.version, 0);
        // 推 v1
        let n1 = sync::push(acct.clone(), "{\"a\":1}".into(), 0).await.expect("push1");
        assert_eq!(n1, 1);
        // 错误 base 冲突
        let e = sync::push(acct.clone(), "{\"a\":2}".into(), 0).await.unwrap_err();
        assert!(e.starts_with("CONFLICT"), "{e}");
        // 正确 base 推 v2
        let n2 = sync::push(acct.clone(), "{\"a\":2}".into(), 1).await.expect("push2");
        assert_eq!(n2, 2);
        // 拉取
        let p = sync::pull(acct.clone()).await.expect("pull");
        assert!(p.exists); assert_eq!(p.version, 2); assert_eq!(p.blob, "{\"a\":2}");
        // 日志
        let l = sync::logs(acct.clone(), 5).await.expect("logs");
        assert!(l["list"].as_array().map(|a| a.len() >= 4).unwrap_or(false));
        // 登录（非注册）
        let acct2 = sync::login(server(), u.clone(), "Test12345678".into(), false).await.expect("login");
        assert!(!acct2.token.is_empty());
        // 错密码
        assert!(sync::login(server(), u.clone(), "wrong".into(), false).await.is_err());
        // 坏 token
        let bad = sync::SyncAccount { server: server(), token: "x.y.z".into(), user: String::new() };
        let e = sync::version(bad).await.unwrap_err();
        assert!(e.contains("未登录") || e.contains("401"), "{e}");
        println!("ALL SYNC TESTS PASSED for {u}");
    });
}
