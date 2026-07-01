using System;
using System.Threading.Tasks;
using Unity.Services.Authentication;
using Unity.Services.Core;
using UnityEngine;

namespace BackpackAdventures.CloudCode.Client
{
    public class CloudCodeIntegrationTest : MonoBehaviour
    {
        [SerializeField] private string testPlayerId = "player_123";

        [ContextMenu("Run All Tests")]
        public void RunAllTests()
        {
            RunAllTestsAsync();
        }

        private async void RunAllTestsAsync()
        {
            Debug.Log("[CloudCodeIntegrationTest] === Starting all API tests ===");

            try
            {
                await BackpackCloudCodeService.InitializeAsync();
                Debug.Log("[CloudCodeIntegrationTest] Signed in as: " + AuthenticationService.Instance.PlayerId);
                Debug.Log("[CloudCodeIntegrationTest] UGS Project ID: " + Application.cloudProjectId);
            }
            catch (Exception ex)
            {
                Debug.LogError("[CloudCodeIntegrationTest] FAIL — InitializeAsync: " + ex.Message);
                return;
            }

            await RunHealthCheckTest();
            await RunPlayerEchoTest();
            await RunServerConfigTest();

            Debug.Log("[CloudCodeIntegrationTest] === All tests complete ===");
        }

        private async Task RunHealthCheckTest()
        {
            Debug.Log("[CloudCodeIntegrationTest] --- HealthCheck ---");
            try
            {
                var response = await BackpackCloudCodeService.CallHealthCheckAsync();
                bool valid = CloudCodeValidator.ValidateHealthCheck(response);
                if (valid)
                    Debug.Log("[CloudCodeIntegrationTest] PASS — HealthCheck");
                else
                    Debug.LogError("[CloudCodeIntegrationTest] FAIL — HealthCheck: validation failed");
            }
            catch (Exception ex)
            {
                Debug.LogError("[CloudCodeIntegrationTest] FAIL — HealthCheck threw: " + ex.Message);
            }
        }

        private async Task RunPlayerEchoTest()
        {
            Debug.Log("[CloudCodeIntegrationTest] --- PlayerEcho ---");
            try
            {
                var response = await BackpackCloudCodeService.CallPlayerEchoAsync(testPlayerId);
                bool valid = CloudCodeValidator.ValidatePlayerEcho(response, testPlayerId);
                if (valid)
                    Debug.Log("[CloudCodeIntegrationTest] PASS — PlayerEcho");
                else
                    Debug.LogError("[CloudCodeIntegrationTest] FAIL — PlayerEcho: validation failed");
            }
            catch (Exception ex)
            {
                Debug.LogError("[CloudCodeIntegrationTest] FAIL — PlayerEcho threw: " + ex.Message);
            }
        }

        private async Task RunServerConfigTest()
        {
            Debug.Log("[CloudCodeIntegrationTest] --- ServerConfig ---");
            try
            {
                var response = await BackpackCloudCodeService.CallServerConfigAsync();
                bool valid = CloudCodeValidator.ValidateServerConfig(response);
                if (valid)
                    Debug.Log("[CloudCodeIntegrationTest] PASS — ServerConfig");
                else
                    Debug.LogError("[CloudCodeIntegrationTest] FAIL — ServerConfig: validation failed");
            }
            catch (Exception ex)
            {
                Debug.LogError("[CloudCodeIntegrationTest] FAIL — ServerConfig threw: " + ex.Message);
            }
        }
    }
}
