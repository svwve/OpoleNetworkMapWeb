package com.example.backend.controllers;

import com.example.backend.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthControllerTest {

    private final AuthController controller = new AuthController(new UserService(null));

    @Test
    void sessionCheckReportsUnauthenticatedWhenSessionIsMissing() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getSession(false)).thenReturn(null);

        Map<String, Object> response = controller.session(request).getBody();

        assertEquals(Boolean.FALSE, response.get("success"));
    }

    @Test
    void sessionCheckReturnsAuthenticatedUserAndRole() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpSession session = mock(HttpSession.class);
        when(request.getSession(false)).thenReturn(session);
        when(session.getAttribute("username")).thenReturn("operator");
        when(session.getAttribute("role")).thenReturn("OPERATOR");

        Map<String, Object> response = controller.session(request).getBody();

        assertEquals(Boolean.TRUE, response.get("success"));
        assertEquals("operator", response.get("username"));
        assertEquals("OPERATOR", response.get("role"));
    }
}
