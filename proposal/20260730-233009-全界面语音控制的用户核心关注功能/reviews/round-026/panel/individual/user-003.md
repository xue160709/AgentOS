Participant：user-003（E4 固定画像）  
Design revision：R027  
Design SHA：40ac35e6b499c10353e41eed4fe613a9943fbd6b6278161e8346af0541ea5e5b

Need verdict：NEED-002 满足；NEED-003 部分满足；NEED-004 部分满足；NEED-005 满足。总体：REVISE。

评分：74/80

- Core need and pain resolution：28/30（F1 -2）
- Journey effectiveness and efficiency：17/18（F1 -1）
- Understanding expectation and feedback：11/12（F1 -1）
- Control recovery and trust：10/12（F1 -1，F2 -1）
- Accessibility and context fit：8/8

Findings：

1. **NEED-004｜§4、§6、§7、§8｜任务进入 NEEDS_USER_CHECK/CLOSED_UNVERIFIED 后用户已在外部看到结果**：“核对可见结果/签名人工核验”未说明由谁签、如何录入证据、怎样进入终态并释放锁；用户知道结果却无法续行；-5。验收：恢复卡可完成含对象、证据、时间、权限来源的人工核验；合法核验后更新唯一终态、释放 scope，重启可追溯；证据不足时不解锁并给替代路径。
2. **NEED-003｜§4、§6、§7、§8｜停录失败后退出并打开麦克风设置再重开**：缺少跨退出的隐私确认与原稿恢复；-1。验收：重开先权威复核句柄，未归零继续禁录告警，归零才消警，同时恢复原稿与下一步。

Discussion topics：人工核验的可信签名与解锁边界；退出后的停麦证明、原稿续接和恢复入口。

读取审计：仅指定 bundle；未读取其他 Proposal、旧评审、设计师或参与者内容。
