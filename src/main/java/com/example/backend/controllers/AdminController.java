package com.example.backend.controllers;

import com.example.backend.UserService;
import com.example.model.Role;
import com.example.model.User;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/users")
public class AdminController {

    private final UserService userService;

    public AdminController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getApprovedUsers() {
        List<Map<String, Object>> users = userService.getApprovedUsers().stream()
                .map(AdminController::userSummary)
                .toList();
        return ResponseEntity.ok(users);
    }

    @PutMapping("/{id}/role")
    public ResponseEntity<Map<String, Object>> changeUserRole(
            @PathVariable Long id, @Valid @RequestBody RoleChangeRequest request) {
        return userService.changeApprovedUserRole(id, request.role())
                .map(user -> ResponseEntity.ok(userSummary(user)))
                .orElseGet(() -> ResponseEntity.badRequest().body(Map.of(
                        "error", "Nie można zmienić roli tego użytkownika."
                )));
    }

    private static Map<String, Object> userSummary(User user) {
        return Map.of(
                "id", user.getId(),
                "username", user.getUsername(),
                "role", user.getRole().name());
    }

    public record RoleChangeRequest(@NotNull Role role) {
    }
}
